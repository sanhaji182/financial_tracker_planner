package digital.asisten.keuangan;

import android.Manifest;
import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import java.util.Calendar;

public class AdvisorBriefingReceiver extends BroadcastReceiver {
    public static final String PREFS_NAME = "kb_ai_advisor_briefing";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_TITLE = "title";
    private static final String KEY_BODY = "body";
    private static final String KEY_HOUR = "hour";
    private static final String KEY_MINUTE = "minute";

    private static final int ALARM_REQUEST_CODE = 4411;
    private static final int NOTIFICATION_ID = 4412;
    private static final String CHANNEL_ID = "kb_proactive_alerts";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null) {
            return;
        }
        String action = intent != null ? intent.getAction() : null;
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)) {
            scheduleFromSavedPrefs(context);
            return;
        }

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(KEY_ENABLED, false);
        scheduleFromSavedPrefs(context);

        if (!enabled) {
            return;
        }
        String title = prefs.getString(KEY_TITLE, "Ringkasan Pagi AI Advisor");
        String body = prefs.getString(KEY_BODY, "Ketuk untuk melihat ringkasan kas, tagihan dekat, dan saran finansial hari ini.");
        postBriefingNotification(context, title, body);
    }

    public static void scheduleDailyBriefing(
            Context context,
            boolean enabled,
            String title,
            String body,
            int hour,
            int minute) {
        if (context == null) {
            return;
        }
        int clampedHour = Math.max(0, Math.min(23, hour));
        int clampedMinute = Math.max(0, Math.min(59, minute));
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putBoolean(KEY_ENABLED, enabled)
                .putString(KEY_TITLE, title != null && !title.trim().isEmpty() ? title : "Ringkasan Pagi AI Advisor")
                .putString(KEY_BODY, body != null && !body.trim().isEmpty() ? body : "Ketuk untuk meninjau ringkasan keuangan hari ini bersama AI Advisor.")
                .putInt(KEY_HOUR, clampedHour)
                .putInt(KEY_MINUTE, clampedMinute)
                .apply();

        scheduleFromSavedPrefs(context);
    }

    private static void scheduleFromSavedPrefs(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            return;
        }
        Intent intent = new Intent(context, AdvisorBriefingReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getBroadcast(context, ALARM_REQUEST_CODE, intent, flags);
        am.cancel(pi);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_ENABLED, false)) {
            return;
        }

        int hour = prefs.getInt(KEY_HOUR, 7);
        int minute = prefs.getInt(KEY_MINUTE, 30);
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, hour);
        cal.set(Calendar.MINUTE, minute);
        cal.set(Calendar.SECOND, 0);
        cal.set(Calendar.MILLISECOND, 0);
        if (cal.getTimeInMillis() <= System.currentTimeMillis() + 5_000L) {
            cal.add(Calendar.DAY_OF_MONTH, 1);
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
        } else {
            am.set(AlarmManager.RTC_WAKEUP, cal.getTimeInMillis(), pi);
        }
    }

    private static void postBriefingNotification(Context context, String title, String body) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID,
                    "Pengingat Proaktif Keuangan",
                    NotificationManager.IMPORTANCE_DEFAULT);
            channel.setDescription("Notifikasi tagihan jatuh tempo, ringkasan harian AI Advisor, dan persetujuan pasangan");
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(channel);
            }
        }

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        launchIntent.putExtra("kb_route", "/?openAdvisor=1");
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(context, NOTIFICATION_ID, launchIntent, piFlags);

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_tile_quick_entry)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
    }
}
