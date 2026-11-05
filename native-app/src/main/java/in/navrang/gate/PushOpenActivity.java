package in.navrang.gate;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import java.util.HashMap;
import java.util.Map;

/** Only immutable PendingIntents can reach this non-exported activity. */
public final class PushOpenActivity extends Activity {
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved);
        try {
            Map<String, String> data = new HashMap<>();
            for (String key : new String[]{"eventId", "bindingId", "revision"}) data.put(key, getIntent().getStringExtra(key));
            PushCoordinator.get(this).requestOpen(data);
            startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP));
        } catch (Exception ignored) { }
        finish();
    }
}
