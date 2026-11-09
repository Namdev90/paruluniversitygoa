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
    private var pushHostReady = false
    private var nativeVoice: VoiceSessionClient? = null
    private var nativeLocator: NativeLocator? = null
    private var nativeFindMe: NativeFindMeActions? = null
    @Volatile private var nativeLocatorScope = ""
    private var lockUi: NativeLockUi? = null

    override fun onCreate(savedInstanceState: android.os.Bundle?) {
        NativeAppLock.install(this)
        super.onCreate(savedInstanceState)
        nativeLocator = NativeLocator(this, { nativeLocatorReply(it) })
        nativeFindMe = NativeFindMeActions(this)
        lockUi = NativeLockUi(this, { covered ->
            nativePrivateCover(covered)
            if (covered && NativeAppLock.locked()) nativeLocator?.identityChanging()
            if (covered && NativeAppLock.locked()) nativeFindMe?.identityChanging()
            if (covered && NativeAppLock.locked()) nativeVoice?.identityChanging()
            else if (!covered && BuildConfig.PUSH_ENABLED && pushHostReady) runCatching {
                PushCoordinator.get(this).resume()
                PushCoordinator.get(this).openWhenReady()
            }
        }, { nativeLocalSignOut() })
    }

    override fun nativeVoiceCommand(action: String, payload: String?): String =
        if (NativeAppLock.locked()) super.nativeVoiceCommand(action, payload)
        else nativeVoice?.command(action, payload) ?: super.nativeVoiceCommand(action, payload)

    override fun nativeLocatorCommand(action: String, payload: String?) {
        nativeLocator?.command(action, payload) ?: super.nativeLocatorCommand(action, payload)
    }
    override fun nativeLocatorRequest(action: String): Long {
        val fence = nativeFindMe?.request(action) ?: 0L
        if (action == "locator-stop" || action == "locator-consent") runOnUiThread { nativeLocator?.identityChanging() }
        return fence
    }
    override fun nativeLocatorResponse(action: String, payload: org.json.JSONObject, response: org.json.JSONObject, generation: Long, token: String, requestFence: Long, elapsedMs: Long) {
        if (action == "locator-status" && response.has("onDuty")) {
            if (!response.optBoolean("onDuty") || !response.optBoolean("findMe")) nativeFindMe?.request("locator-stop")
            if (!response.optBoolean("onDuty") || !response.optBoolean("location")) runOnUiThread { nativeLocator?.identityChanging() }
            return
        }
        if (action == "locator-inbox") {
            val items=response.optJSONArray("items") ?: return
            val ids=(0 until minOf(items.length(),5)).mapNotNull { items.optJSONObject(it)?.optString("requestId") }.toSet()
            runOnUiThread { nativeLocator?.retainRequests(ids); nativeFindMe?.retainRequests(ids) }
            return
        }
        if (action != "locator-respond") return
        val runtime = GateRuntime.get(this)
        val session = runtime.sessions.read() ?: return
        val family = session.optString("refreshFamilyId")
        val scope = NativeLocator.scope(session.optJSONObject("profile"))
        val volunteer = session.optJSONObject("profile")?.optString("name").orEmpty()
        val requestCopy = org.json.JSONObject(payload.toString()); val replyCopy = org.json.JSONObject(response.toString())
        runOnUiThread {
            nativeFindMe?.response(requestCopy, replyCopy, requestFence, elapsedMs, volunteer) {
                !NativeAppLock.locked() && runtime.privateAccessAllowed() && runtime.sessions.sameIdentity(generation, token, family) && scope == NativeLocator.scope(runtime.sessions.read()?.optJSONObject("profile"))
            }
        }
    }

    override fun nativeHostReady() {
        pushHostReady = true
        if (BuildConfig.PUSH_ENABLED && !NativeAppLock.locked()) runCatching { PushCoordinator.get(this).openWhenReady() }
    }

    override fun nativeIdentityChanging() {
        nativeFindMe?.request("locator-stop")
        runOnUiThread {
            nativeLocator?.identityChanging()
            nativeFindMe?.identityChanging()
            NativeAppLock.identityChanged()
            nativeVoice?.identityChanging()
            if (BuildConfig.PUSH_ENABLED) runCatching { PushCoordinator.get(this).identityChanging() }
        }
    }
    override fun event(event: org.json.JSONObject) {
        if (event.optString("type") in setOf("auth","profile")) {
            val scope=runCatching { NativeLocator.scope(GateRuntime.get(this).sessions.read()?.optJSONObject("profile")) }.getOrDefault("")
            if (scope!=nativeLocatorScope) {
                nativeLocatorScope=scope
                nativeFindMe?.request("locator-stop")
                runOnUiThread { nativeLocator?.identityChanging(); nativeFindMe?.identityChanging() }
            }
        }
        super.event(event)
    }

    override fun nativeNotificationFeed(feed: org.json.JSONObject, generation: Long, token: String) {
        if (BuildConfig.PUSH_ENABLED) runCatching { PushCoordinator.get(this).pruneNotifications(feed, generation, token) }
    }

    override fun onResume() {
        super.onResume()
        lockUi?.resume()
        nativeLocator?.resume()
        nativeFindMe?.resume()
        if (nativeVoice == null) nativeVoice = VoiceSessionClient(this)
        if (!NativeAppLock.locked()) nativeVoice?.resume()
        if (BuildConfig.PUSH_ENABLED && !NativeAppLock.locked()) runCatching {
            PushCoordinator.get(this).resume()
            if (pushHostReady) PushCoordinator.get(this).openWhenReady()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == VoiceCoordinator.MICROPHONE_PERMISSION) nativeVoice?.permissionResult()
        if (BuildConfig.PUSH_ENABLED && permissions.contains(android.Manifest.permission.POST_NOTIFICATIONS))
            runCatching { PushCoordinator.get(this).resume() }
    }

    override fun onPause() {
        nativeLocator?.pause()
        nativeFindMe?.pause()
        lockUi?.pause()
        nativeVoice?.pause()
        super.onPause()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        nativeVoice?.focusChanged(hasFocus)
    }

    private var credentialJob: Job? = null
    private var credentialOperation = ""

    override fun googleLoginForOperation(operationId: String) {
        if (credentialJob?.isActive == true) {
            nativeAuthState(operationId, "failed", -1)
            return
        }
        credentialOperation = operationId
        googleLogin()
    }

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
        nativeLocator?.close()
        nativeLocator = null
        nativeFindMe?.close()
        nativeFindMe = null
        lockUi?.close()
        lockUi = null
        nativeVoice?.close()
        nativeVoice = null
        pendingImport = null
        importDialog?.dismiss()
        importDialog = null
        super.onDestroy()
    }

    override fun updatesEnabled() = !BuildConfig.DEBUG

    override fun scannerActivity() = ClassicScannerActivity::class.java

    override fun browserGoogleLogin() {
        runOnUiThread {
            val operation = credentialOperation
            if (BuildConfig.DEBUG) {
                nativeAuthState(operation, "failed", -1)
                nativeError("Google sign-in is disabled in the isolated internal build.")
                return@runOnUiThread
            }
            credentialJob?.cancel()
            nativeIdentityChanging()
            super.googleLogin()
        }
    }

    override fun googleLogin() {
        runOnUiThread {
            if (credentialJob?.isActive == true) return@runOnUiThread
            val operation = credentialOperation
            if (BuildConfig.DEBUG) {
                nativeAuthState(operation, "failed", -1)
                nativeError("Google sign-in is disabled in the isolated internal build.")
                return@runOnUiThread
            }
            credentialJob = lifecycleScope.launch {
                var authGeneration = -1L
                try {
                    val repo = GateRepository.open(this@MainActivity)
                    nativeIdentityChanging()
                    val generation = repo.beginGoogle()
                    authGeneration = generation
                    nativeAuthState(operation, "pending", generation)
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
                    nativeAuthState(operation, "completed", generation)
                } catch (_: GetCredentialCancellationException) {
                    nativeAuthState(operation, "cancelled", authGeneration)
                    nativeError("Google sign-in cancelled. You can try again or use browser sign-in.")
                } catch (_: NoCredentialException) {
                    nativeAuthState(operation, "failed", authGeneration)
                    nativeError("No Google credential is available. Try browser sign-in.")
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (_: Exception) {
                    nativeAuthState(operation, "failed", authGeneration)
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
