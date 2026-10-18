package `in`.navrang.gate

import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.lifecycleScope
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import java.security.MessageDigest
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

/** Original Navrang interface, with the current native sign-in and scanner underneath. */
class MainActivity : ClassicActivity() {
    private var credentialJob: Job? = null

    override fun updatesEnabled() = !BuildConfig.DEBUG

    override fun scannerActivity() = ClassicScannerActivity::class.java

    override fun googleLogin() {
        runOnUiThread {
            if (credentialJob?.isActive == true) return@runOnUiThread
            if (BuildConfig.DEBUG) {
                nativeError("Google sign-in is disabled in the isolated internal build.")
                return@runOnUiThread
            }
            credentialJob = lifecycleScope.launch {
                try {
                    val repo = GateRepository.open(this@MainActivity)
                    val generation = repo.beginGoogle()
                    val nonce = Pkce.verifier()
                    val hashed = MessageDigest.getInstance("SHA-256").digest(nonce.toByteArray())
                        .joinToString("") { "%02x".format(it.toInt() and 255) }
                    val option = GetSignInWithGoogleOption.Builder(
                        repo.runtime.api.config.getString("googleWebClientId")
                    ).setNonce(hashed).build()
                    val credential = CredentialManager.create(this@MainActivity).getCredential(
                        this@MainActivity,
                        GetCredentialRequest.Builder().addCredentialOption(option).build()
                    ).credential
                    require(credential is CustomCredential &&
                        (credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL ||
                            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL))
                    val token = GoogleIdTokenCredential.createFrom(credential.data).idToken
                    repo.googleIdToken(token, nonce, generation)
                } catch (_: GetCredentialCancellationException) {
                    nativeError("Google sign-in cancelled. You can try again.")
                } catch (_: NoCredentialException) {
                    super.googleLogin()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    nativeError("Google sign-in could not complete. Retry, or use your assigned staff code.")
                }
            }
        }
    }

    override fun clearCredentialProvider() {
        runOnUiThread {
            credentialJob?.cancel()
            lifecycleScope.launch {
                try {
                    CredentialManager.create(this@MainActivity)
                        .clearCredentialState(ClearCredentialStateRequest())
                } catch (_: Exception) { /* Durable local sign-out is already complete. */ }
            }
        }
    }
}
