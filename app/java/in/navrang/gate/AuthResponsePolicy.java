package in.navrang.gate;

import org.json.JSONObject;

/** A transport/gateway 401 is not proof that this app's opaque session was revoked. */
public final class AuthResponsePolicy {
    private AuthResponsePolicy() {}
    public static boolean sessionRejected(JSONObject body) {
        if (body == null || !Boolean.FALSE.equals(body.opt("ok"))) return false;
        switch (body.optString("error")) {
            case "Sign in again.":
            case "Session expired.":
            case "Sign in again. Your session expired.":
            case "Staff access expired. Sign in again.":
            case "Staff access expired. Ask Namdev for a new code.":
                return true;
            default: return false;
        }
    }
}
