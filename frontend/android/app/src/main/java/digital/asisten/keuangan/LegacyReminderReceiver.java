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
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;

public class LegacyReminderReceiver extends BroadcastReceiver {
    public static final String PREFS_NAME = "kb_legacy_checkin";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_PAUSED = "paused";
    private static final String KEY_NEXT_DUE_MS = "next_due_ms";
    private static final String KEY_REMINDER_HOUR = "reminder_hour";
    private static final String KEY_LAST_CHECKIN_DAY = "last_checkin_day";

    private static final int ALARM_REQUEST_CODE = 4401;
    private static final int NOTIFICATION_ID = 4402;
    private static final String CHANNEL_ID = "kb_legacy_checkin";

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
        boolean paused = prefs.getBoolean(KEY_PAUSED, false);
        long nextDueMs = prefs.getLong(KEY_NEXT_DUE_MS, 0L);
        String lastCheckinDay = prefs.getString(KEY_LAST_CHECKIN_DAY, "");

        // Chain next daily reminder cleanly
        scheduleFromSavedPrefs(context);

        if (!enabled || paused) {
            return;
        }

        long now = System.currentTimeMillis();
        String todayDay = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(new Date(now));
        boolean dueWithin24HoursOrOverdue = nextDueMs <= 0L || (nextDueMs - now) <= 86_400_000L;
        if (!dueWithin24HoursOrOverdue && todayDay.equals(lastCheckinDay)) {
            return;
        }
        if (dueWithin24HoursOrOverdue && !todayDay.equals(lastCheckinDay)) {
            postReminderNotification(context, now >= nextDueMs && nextDueMs > 0L);
        }
    }

    public static void scheduleDailyReminder(
            Context context,
            boolean enabled,
            boolean paused,
            long nextDueEpochMs,
            int reminderHour,
            String lastCheckinDay) {
        if (context == null) {
            return;
        }
        int clampedHour = Math.max(0, Math.min(23, reminderHour));
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putBoolean(KEY_ENABLED, enabled)
                .putBoolean(KEY_PAUSED, paused)
                .putLong(KEY_NEXT_DUE_MS, Math.max(0L, nextDueEpochMs))
                .putInt(KEY_REMINDER_HOUR, clampedHour)
                .putString(KEY_LAST_CHECKIN_DAY, lastCheckinDay != null ? lastCheckinDay : "")
                .apply();

        scheduleFromSavedPrefs(context);
    }

    private static void scheduleFromSavedPrefs(Context context) {
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) {
            return;
        }
        Intent intent = new Intent(context, LegacyReminderReceiver.class);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pi = PendingIntent.getBroadcast(context, ALARM_REQUEST_CODE, intent, flags);
        am.cancel(pi);

        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        if (!prefs.getBoolean(KEY_ENABLED, false) || prefs.getBoolean(KEY_PAUSED, false)) {
            return;
        }

        int hour = prefs.getInt(KEY_REMINDER_HOUR, 20);
        Calendar cal = Calendar.getInstance();
        cal.set(Calendar.HOUR_OF_DAY, hour);
        cal.set(Calendar.MINUTE, 0);
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

    private static void postReminderNotification(Context context, boolean isOverdue) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
                return;
            }
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID,
                    "Pengingat Check-In Darurat",
                    NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Alarm pengingat harian agar timer Wasiat Digital tetap aktif");
            NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) {
                nm.createNotificationChannel(ch);
            }
        }

        Intent launchIntent = new Intent(context, MainActivity.class);
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        launchIntent.putExtra("kb_route", "/legacy-checkin");
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent pendingIntent = PendingIntent.getActivity(context, NOTIFICATION_ID, launchIntent, piFlags);

        String title = isOverdue
                ? "⚠️ Check-In Wasiat Terlewati!"
                : "⏰ Pengingat Check-In Hari Ini";
        String body = isOverdue
                ? "Anda melewati batas Check-In. Ketuk sekarang untuk membatalkan masa tenggang wasiat."
                : "Ketuk untuk Check-In 1 detik hari ini agar timer Wasiat Digital direset.";

        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_tile_quick_entry)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setAutoCancel(true)
                .setContentIntent(pendingIntent);

        NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, builder.build());
    }
}
