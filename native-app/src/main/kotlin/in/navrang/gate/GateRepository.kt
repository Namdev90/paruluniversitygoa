package `in`.navrang.gate

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

class GateFailure(val status: Int, message: String) : Exception(message)

class StaleSession : Exception("Sign-in or access changed. Refresh to continue.")

/** Network/crypto/database work stays off the main thread. No roster persistence or logging. */
class GateRepository private constructor(val runtime: GateRuntime) {
    companion object {
        suspend fun open(context: Context) =
            withContext(Dispatchers.IO) { GateRepository(GateRuntime.get(context)) }
    }

    suspend fun profile() =
        withContext(Dispatchers.IO) {
            runtime.sessions.read()?.optJSONObject("profile")?.let(Profile::from)
        }

    suspend fun local(): JSONObject =
        withContext(Dispatchers.IO) {
            if (
                runtime.sessions.read()?.optJSONObject("profile")?.let(Profile::from)?.admin == true
            )
                runtime.db.adminView()
            else runtime.db.snapshot()
        }

    suspend fun call(action: String, payload: JSONObject = JSONObject()): JSONObject =
        withContext(Dispatchers.IO) {
            val session = runtime.sessions.read() ?: throw GateFailure(401, "Sign in first.")
            val generation = runtime.sessions.generation()
            val token = session.getString("token")
            val scope = Profile.from(session.getJSONObject("profile")).scope
            val profileRequest = if (action == "me") runtime.sessions.beginProfileRequest() else -1
            val r = runtime.api.call(action, payload, token)
            if (!runtime.sessions.isCurrent(generation, token)) throw StaleSession()
            if (
                action != "me" &&
                    scope !=
                        runtime.sessions.read()?.getJSONObject("profile")?.let(Profile::from)?.scope
            )
                throw StaleSession()
            if (r.status == 401) {
                if (runtime.sessions.clearIfCurrent(generation, token)) {
                    runtime.db.clearTemporary()
                    runtime.emit("auth", JSONObject())
                }
                throw GateFailure(401, "Your session expired. Sign in again.")
            }
            if (r.status != 200 || !r.body.optBoolean("ok")) {
                if (r.status == 403) runtime.refresh()
                throw GateFailure(
                    r.status,
                    r.body.text("error", "The server could not complete this request."),
                )
            }
            if (action == "me") {
                val p = JSONObject(r.body.toString()).apply { remove("ok") }
                if (!runtime.sessions.refreshIfCurrent(generation, token, profileRequest, p))
                    throw StaleSession()
                runtime.emit("profile", p)
            }
            r.body
        }

    suspend fun login(action: String, payload: JSONObject): Profile =
        withContext(Dispatchers.IO) {
            runtime.sessions.clear()
            runtime.db.clearTemporary()
            runtime.emit("auth", JSONObject())
            val generation = runtime.sessions.generation()
            finishLogin(generation, runtime.api.call(action, payload, ""))
        }

    suspend fun beginGoogle(): Long =
        withContext(Dispatchers.IO) {
            runtime.sessions.clear()
            runtime.db.clearTemporary()
            runtime.emit("auth", JSONObject())
            runtime.sessions.generation()
        }

    suspend fun googleIdToken(idToken: String, rawNonce: String, generation: Long): Profile =
        withContext(Dispatchers.IO) {
            if (generation != runtime.sessions.generation()) throw StaleSession()
            val exchange = runtime.api.exchangeGoogleIdToken(idToken, rawNonce)
            if (exchange.status != 200)
                throw GateFailure(
                    exchange.status,
                    "Google credential was rejected. Try again or use browser sign-in.",
                )
            if (generation != runtime.sessions.generation()) throw StaleSession()
            // A Google ID token is never passed as a Navrang access token.
            finishLogin(
                generation,
                runtime.api.call(
                    "google-login",
                    json("accessToken" to exchange.body.getString("access_token")),
                    "",
                ),
            )
        }

    suspend fun oauth(code: String, verifier: String, generation: Long): Profile =
        withContext(Dispatchers.IO) {
            if (generation != runtime.sessions.generation()) throw StaleSession()
            val exchange = runtime.api.exchange(code, verifier)
            if (exchange.status != 200)
                throw GateFailure(
                    exchange.status,
                    "Google sign-in could not finish. Start sign-in again.",
                )
            if (generation != runtime.sessions.generation()) throw StaleSession()
            finishLogin(
                generation,
                runtime.api.call(
                    "google-login",
                    json("accessToken" to exchange.body.getString("access_token")),
                    "",
                ),
            )
        }

    private fun finishLogin(generation: Long, r: GateApi.Reply): Profile {
        if (r.status != 200 || !r.body.optBoolean("ok"))
            throw GateFailure(r.status, r.body.text("error", "Sign-in failed."))
        if (
            !runtime.sessions.saveIfCurrent(
                generation,
                r.body.getString("token"),
                r.body.getJSONObject("profile"),
            )
        )
            throw StaleSession()
        runtime.db.clearTemporary()
        runtime.emit("auth", r.body.getJSONObject("profile"))
        runtime.refresh()
        return Profile.from(r.body.getJSONObject("profile"))
    }

    suspend fun clearSession(): String? =
        withContext(Dispatchers.IO) {
            val token = runtime.sessions.read()?.text("token")
            check(runtime.sessions.clearDurably()) { "Could not persist sign-out." }
            runtime.db.clearTemporary()
            runtime.emit("auth", JSONObject())
            token
        }

    suspend fun revokeSession(token: String) =
        withContext(Dispatchers.IO) {
            try {
                runtime.api.call("logout", JSONObject(), token)
            } catch (_: Exception) {}
        }

    suspend fun submit(id: String) = withContext(Dispatchers.IO) { runtime.submit(id) }

    suspend fun refresh() = withContext(Dispatchers.IO) { runtime.refresh() }

    suspend fun mayExport(generation: Long, contacts: Boolean): Boolean =
        withContext(Dispatchers.IO) {
            if (generation != runtime.sessions.generation()) return@withContext false
            val p = runtime.sessions.read()?.optJSONObject("profile")?.let(Profile::from)
            if (contacts) p?.admin == true else p?.canReport == true
        }
}
