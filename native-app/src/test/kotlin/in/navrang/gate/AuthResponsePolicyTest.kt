package `in`.navrang.gate

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [24, 35])
class AuthResponsePolicyTest {
    @Test fun unrelated401DoesNotInvalidateTheOpaqueNavrangSession() {
        assertFalse(AuthResponsePolicy.sessionRejected(JSONObject().put("message", "Invalid JWT")))
        assertFalse(AuthResponsePolicy.sessionRejected(JSONObject().put("ok", false).put("error", "Gateway unavailable")))
        assertFalse(AuthResponsePolicy.sessionRejected(JSONObject().put("ok", true).put("error", "Sign in again.")))
    }
    @Test fun explicitApplicationRevocationAndExpiryRemainAuthoritative() {
        for (message in listOf("Sign in again.", "Session expired.", "Sign in again. Your session expired.",
                "Staff access expired. Sign in again.", "Staff access expired. Ask Namdev for a new code.")) {
            assertTrue(AuthResponsePolicy.sessionRejected(JSONObject().put("ok", false).put("error", message)))
        }
    }
}
