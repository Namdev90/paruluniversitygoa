package `in`.navrang.gate

import android.app.AlertDialog
import android.net.Uri
import androidx.activity.result.contract.ActivityResultContracts
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Original Navrang interface, with the current native sign-in and scanner underneath. */
class MainActivity : ClassicActivity() {
    private var credentialJob: Job? = null

    private data class ImportIdentity(val generation: Long, val token: String)

    private var pendingImport: ImportIdentity? = null
    private var importJob: Job? = null
    private var importDialog: AlertDialog? = null
    private val importPicker =
        registerForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
            val identity = pendingImport
            pendingImport = null
            if (uri != null && identity != null) readImport(uri, identity)
        }

    override fun importRegistrations() {
        if (pendingImport != null || importJob?.isActive == true || importDialog != null) return
        importJob = lifecycleScope.launch {
            try {
                val repo = GateRepository.open(this@MainActivity)
                repo.call("me")
                require(repo.profile()?.admin == true) { "Administrator access is required." }
                val session = repo.runtime.sessions.read() ?: error("Sign in again.")
                pendingImport =
                    ImportIdentity(repo.runtime.sessions.generation(), session.getString("token"))
                importPicker.launch(
                    arrayOf(
                        "text/csv",
                        "text/comma-separated-values",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    )
                )
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                pendingImport = null
                nativeError(failure.message ?: "Could not open registration import.")
            }
        }
    }

    private suspend fun requireImportIdentity(repo: GateRepository, identity: ImportIdentity) {
        require(repo.runtime.sessions.isCurrent(identity.generation, identity.token)) {
            "Sign-in changed. Start import again."
        }
        repo.call("me")
        require(
            repo.runtime.sessions.isCurrent(identity.generation, identity.token) &&
                repo.profile()?.admin == true
        ) {
            "Administrator access changed. Import was cancelled."
        }
    }

    private fun readImport(uri: Uri, identity: ImportIdentity) {
        importJob = lifecycleScope.launch {
            try {
                val repo = GateRepository.open(this@MainActivity)
                requireImportIdentity(repo, identity)
                val rows =
                    withContext(Dispatchers.IO) {
                        contentResolver.openInputStream(uri).use { input ->
                            requireNotNull(input) { "Could not read the selected file." }
                            val bytes = RegistrationImport.readBounded(input)
                            try {
                                RegistrationImport.parse(bytes)
                            } finally {
                                bytes.fill(0)
                            }
                        }
                    }
                val payload = withContext(Dispatchers.Default) { RegistrationImport.payload(rows) }
                requireImportIdentity(repo, identity)
                importDialog =
                    AlertDialog.Builder(this@MainActivity)
                        .setTitle("Import registrations?")
                        .setMessage(
                            "Import ${rows.length()} registrations for this event. Confirmed entry history is preserved."
                        )
                        .setNegativeButton("Cancel", null)
                        .setPositiveButton("Import") { _, _ ->
                            importJob = lifecycleScope.launch {
                                try {
                                    requireImportIdentity(repo, identity)
                                    repo.call(
                                        "import",
                                        payload,
                                    )
                                    repo.refresh()
                                    repo.runtime.emit(
                                        "registrations-imported",
                                        org.json.JSONObject(),
                                    )
                                    nativeNotice(
                                        "Registration import saved. Confirmed entry history is preserved."
                                    )
                                } catch (cancelled: CancellationException) {
                                    throw cancelled
                                } catch (failure: Exception) {
                                    nativeError(
                                        failure.message ?: "Registration import could not complete."
                                    )
                                }
                            }
                        }
                        .setOnDismissListener { importDialog = null }
                        .show()
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (failure: Exception) {
                nativeError(failure.message ?: "Registration file could not be read.")
            }
        }
    }

    override fun onDestroy() {
        pendingImport = null
        importDialog?.dismiss()
        importDialog = null
        super.onDestroy()
    }

    override fun updatesEnabled() = !BuildConfig.DEBUG

    override fun scannerActivity() = ClassicScannerActivity::class.java

    override fun browserGoogleLogin() {
        runOnUiThread {
            if (BuildConfig.DEBUG) {
                nativeError("Google sign-in is disabled in the isolated internal build.")
                return@runOnUiThread
            }
            credentialJob?.cancel()
            super.googleLogin()
        }
    }

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
                    val hashed =
                        MessageDigest.getInstance("SHA-256")
                            .digest(nonce.toByteArray())
                            .joinToString("") { "%02x".format(it.toInt() and 255) }
                    val option =
                        GetSignInWithGoogleOption.Builder(
                                repo.runtime.api.config.getString("googleWebClientId")
                            )
                            .setNonce(hashed)
                            .build()
                    val credential =
                        CredentialManager.create(this@MainActivity)
                            .getCredential(
                                this@MainActivity,
                                GetCredentialRequest.Builder().addCredentialOption(option).build(),
                            )
                            .credential
                    require(
                        credential is CustomCredential &&
                            (credential.type ==
                                GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL ||
                                credential.type ==
                                    GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL)
                    )
                    val token = GoogleIdTokenCredential.createFrom(credential.data).idToken
                    repo.googleIdToken(token, nonce, generation)
                } catch (_: GetCredentialCancellationException) {
                    nativeError("Google sign-in cancelled. You can try again.")
                } catch (_: NoCredentialException) {
                    super.googleLogin()
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    nativeError(
                        "Google sign-in could not complete. Try browser sign-in or your assigned staff code."
                    )
                }
            }
        }
    }

    override fun clearCredentialProvider() {
        runOnUiThread {
            credentialJob?.cancel()
            importJob?.cancel()
            pendingImport = null
            importDialog?.dismiss()
            importDialog = null
            lifecycleScope.launch {
                try {
                    CredentialManager.create(this@MainActivity)
                        .clearCredentialState(ClearCredentialStateRequest())
                } catch (_: Exception) {
                    /* Durable local sign-out is already complete. */
                }
            }
        }
    }
}
