package `in`.navrang.gate

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.NoCredentialException
import androidx.lifecycle.lifecycleScope
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import java.security.MessageDigest
import kotlinx.coroutines.*

class MainActivity : ComponentActivity() {
    private val model: GateViewModel by viewModels()
    private lateinit var readiness: GateReadiness
    private var credentialJob: Job? = null
    private val exportPicker =
        registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            model.saveExport(if (result.resultCode == RESULT_OK) result.data?.data else null)
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen()
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        readiness = GateReadiness(this)
        setContent { GateApp(model, ::google, ::browserGoogle, ::pickExport, ::updateAction) }
        callback(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        callback(intent)
    }

    override fun onResume() {
        super.onResume()
        readiness.resume()
        model.foreground(true)
    }

    override fun onPause() {
        GateFeedback.play(this, "stop-intro")
        readiness.pause()
        model.foreground(false)
        super.onPause()
    }

    private fun google() {
        if (credentialJob?.isActive == true) return
        credentialJob = lifecycleScope.launch {
            try {
                val repo = model.repository ?: return@launch
                val generation = model.beginGoogle()
                val nonce = Pkce.verifier()
                val hashed =
                    MessageDigest.getInstance("SHA-256").digest(nonce.toByteArray()).joinToString(
                        ""
                    ) {
                        "%02x".format(it.toInt() and 255)
                    }
                val option =
                    GetSignInWithGoogleOption.Builder(
                            repo.runtime.api.config.getString("googleWebClientId")
                        )
                        .setNonce(hashed)
                        .build()
                val response =
                    CredentialManager.create(this@MainActivity)
                        .getCredential(
                            this@MainActivity,
                            GetCredentialRequest.Builder().addCredentialOption(option).build(),
                        )
                val c = response.credential
                require(
                    c is CustomCredential &&
                        (c.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL ||
                            c.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL)
                )
                val token = GoogleIdTokenCredential.createFrom(c.data).idToken
                model.completeGoogle(token, nonce, generation)
            } catch (_: GetCredentialCancellationException) {
                model.message("Google sign-in cancelled. You can try again.")
            } catch (_: NoCredentialException) {
                model.message(
                    "No Google credential is available. Add an account in Android settings or use browser sign-in."
                )
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                model.message(
                    "Google sign-in could not complete. Try again, use browser sign-in, or enter your assigned checker code."
                )
            }
        }
    }

    private fun browserGoogle() {
        if (BuildConfig.DEBUG) {
            model.message(
                "Browser callbacks are disabled in the isolated internal build. Use the approved production package for device OAuth verification."
            )
            return
        }
        lifecycleScope.launch {
            try {
                val repo = model.repository ?: return@launch
                val generation = model.beginGoogle()
                val verifier = Pkce.verifier()
                val nonce = Pkce.verifier()
                val config =
                    withContext(Dispatchers.IO) {
                        repo.runtime.api.call("config", org.json.JSONObject(), "")
                    }
                require(config.body.optBoolean("googleEnabled")) {
                    "Google sign-in is not configured."
                }
                withContext(Dispatchers.IO) {
                    getSharedPreferences("navrang-pkce", MODE_PRIVATE)
                        .edit()
                        .putString("verifier", verifier)
                        .putString("nonce", nonce)
                        .putLong("created", System.currentTimeMillis())
                        .putLong("sessionGeneration", generation)
                        .commit()
                }
                val redirect =
                    repo.runtime.api.config.getString("oauthRedirect") +
                        "?state=" +
                        Uri.encode(nonce)
                val url =
                    Uri.parse(repo.runtime.api.config.getString("project") + "/auth/v1/authorize")
                        .buildUpon()
                        .appendQueryParameter("provider", "google")
                        .appendQueryParameter("redirect_to", redirect)
                        .appendQueryParameter("code_challenge", Pkce.challenge(verifier))
                        .appendQueryParameter("code_challenge_method", "s256")
                        .build()
                CustomTabsIntent.Builder().build().launchUrl(this@MainActivity, url)
            } catch (_: Exception) {
                model.message(
                    "Browser sign-in could not start. Check your connection and try again."
                )
            }
        }
    }

    private fun callback(intent: Intent?) {
        val uri = intent?.data ?: return
        if (BuildConfig.DEBUG) return
        lifecycleScope.launch {
            while (!model.state.value.ready) delay(50)
            val p = getSharedPreferences("navrang-pkce", MODE_PRIVATE)
            val parsed =
                OAuthCallback.parse(uri.toString(), p.getString("nonce", "")) ?: return@launch
            val verifier = p.getString("verifier", "") ?: ""
            val generation = p.getLong("sessionGeneration", -1)
            val age = System.currentTimeMillis() - p.getLong("created", 0)
            withContext(Dispatchers.IO) { p.edit().clear().commit() }
            setIntent(Intent())
            if (age !in 0..600000 || verifier.isEmpty()) {
                model.message("Sign-in expired. Start again.")
                return@launch
            }
            if (parsed.error.isNotEmpty() || parsed.code.isEmpty()) {
                model.message(parsed.message)
                return@launch
            }
            model.oauth(parsed.code, verifier, generation)
        }
    }

    private fun pickExport() {
        val info = model.exportInfo() ?: return
        model.exportPickerOpened()
        try {
            exportPicker.launch(
                Intent(Intent.ACTION_CREATE_DOCUMENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType(info.second)
                    .putExtra(Intent.EXTRA_TITLE, info.first)
            )
        } catch (_: Exception) {
            model.cancelExport()
            model.message(
                "No document provider is available. Try a different device save location."
            )
        }
    }

    private fun updateAction(action: String) {
        when (action) {
            "install" -> GateUpdater.install(this)
            "auto" -> GateUpdater.setAutomatic(this, !GateUpdater.automatic(this))
            else ->
                if (BuildConfig.DEBUG)
                    model.message("App updates are disabled for the isolated internal build.")
                else GateUpdater.check(this, true, action == "download")
        }
    }
}
