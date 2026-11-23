package digital.asisten.keuangan;

import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Strictly opt-in, 100% on-device listener that captures payment notifications only from
 * allowlisted Indonesian bank and e-wallet packages when explicitly enabled by the user.
 */
public class BankNotificationListenerService extends NotificationListenerService {
    public static final String PREFS_NAME = "kb_notif_capture";
    public static final String KEY_ENABLED = "kb_notif_capture_enabled";
    public static final String KEY_BUFFER = "kb_notif_buffer_json";
    private static final int MAX_BUFFER_ITEMS = 50;

    private static final Set<String> ALLOWED_PACKAGES = new HashSet<>(Arrays.asList(
            "com.bca",
            "com.bca.mybca.omni.android",
            "id.co.bcadigital.blu",
            "src.com.bni",
            "id.co.bni.wondr",
            "id.bmri.livin",
            "id.co.bri.brimo",
            "com.seabank.indonesia",
            "com.jago.digitalBanking",
            "com.gojek.app",
            "id.dana",
            "ovo.id",
            "com.shopee.id",
            "com.linkaja.app"
    ));

    public static ComponentName getComponentName(Context context) {
        return new ComponentName(context, BankNotificationListenerService.class);
    }

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        if (sbn == null || sbn.isOngoing()) {
            return;
        }
        String pkg = sbn.getPackageName();
        if (pkg == null || !ALLOWED_PACKAGES.contains(pkg)) {
            return;
        }

        SharedPreferences prefs = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_ENABLED, false)) {
            return;
        }

        Bundle extras = sbn.getNotification() != null ? sbn.getNotification().extras : null;
        if (extras == null) {
            return;
        }
        CharSequence titleCs = extras.getCharSequence("android.title");
        CharSequence textCs = extras.getCharSequence("android.text");
        CharSequence bigTextCs = extras.getCharSequence("android.bigText");

        String title = titleCs != null ? titleCs.toString().trim() : "";
        String body = bigTextCs != null && bigTextCs.length() > 0
                ? bigTextCs.toString().trim()
                : (textCs != null ? textCs.toString().trim() : "");

        if (title.isEmpty() && body.isEmpty()) {
            return;
        }

        enqueueNotification(this, pkg, title, body, sbn.getPostTime());
    }

    public static synchronized void enqueueNotification(
            Context context, String packageName, String title, String text, long timestamp) {
        try {
            SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String raw = prefs.getString(KEY_BUFFER, "[]");
            JSONArray arr = new JSONArray(raw);

            // Simple dedupe against latest 5 buffered notifications
            int checkStart = Math.max(0, arr.length() - 5);
            for (int i = checkStart; i < arr.length(); i++) {
                JSONObject prev = arr.optJSONObject(i);
                if (prev != null
                        && packageName.equals(prev.optString("packageName"))
                        && text.equals(prev.optString("text"))
                        && Math.abs(timestamp - prev.optLong("timestamp")) < 15000L) {
                    return;
                }
            }

            JSONObject item = new JSONObject();
            item.put("id", "notif-" + UUID.randomUUID().toString());
            item.put("packageName", packageName);
            item.put("title", title);
            item.put("text", text);
            item.put("timestamp", timestamp);
            arr.put(item);

            JSONArray bounded = new JSONArray();
            int startIdx = Math.max(0, arr.length() - MAX_BUFFER_ITEMS);
            for (int i = startIdx; i < arr.length(); i++) {
                bounded.put(arr.get(i));
            }
            prefs.edit().putString(KEY_BUFFER, bounded.toString()).apply();

            LocalOcrPlugin.emitCapturedNotificationsUpdated(bounded.length());
        } catch (Exception ignored) {
        }
    }
}
