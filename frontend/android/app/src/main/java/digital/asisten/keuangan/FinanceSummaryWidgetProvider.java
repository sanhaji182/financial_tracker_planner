package digital.asisten.keuangan;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

/**
 * Android home screen widget showing live Safe-to-Spend, liquid cash, and 1-tap quick entry actions.
 */
public class FinanceSummaryWidgetProvider extends AppWidgetProvider {
    public static final String WIDGET_PREFS = "kb_widget_summary";
    public static final String KEY_SAFE_TO_SPEND = "safe_to_spend";
    public static final String KEY_LIQUID_CASH = "liquid_cash";
    public static final String KEY_NET_WORTH = "net_worth";
    public static final String KEY_UPDATED_LABEL = "updated_label";
    public static final String EXTRA_QUICK_ACTION = "kb_quick_action";

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId);
        }
    }

    public static void refreshAllWidgets(Context context) {
        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        if (manager == null) {
            return;
        }
        int[] ids = manager.getAppWidgetIds(new ComponentName(context, FinanceSummaryWidgetProvider.class));
        for (int appWidgetId : ids) {
            updateAppWidget(context, manager, appWidgetId);
        }
    }

    static void updateAppWidget(Context context, AppWidgetManager appWidgetManager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(WIDGET_PREFS, Context.MODE_PRIVATE);
        String safeToSpend = prefs.getString(KEY_SAFE_TO_SPEND, "Rp 0");
        String liquidCash = prefs.getString(KEY_LIQUID_CASH, "Kas: Rp 0");
        String updatedLabel = prefs.getString(KEY_UPDATED_LABEL, "Siap catat cepat");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_finance_summary);
        views.setTextViewText(R.id.widget_safe_to_spend_value, safeToSpend);
        views.setTextViewText(R.id.widget_liquid_cash_label, liquidCash);
        views.setTextViewText(R.id.widget_status_label, updatedLabel);

        views.setOnClickPendingIntent(
                R.id.widget_root,
                createActionIntent(context, 100, "")
        );
        views.setOnClickPendingIntent(
                R.id.widget_btn_tx,
                createActionIntent(context, 101, "tx")
        );
        views.setOnClickPendingIntent(
                R.id.widget_btn_voice,
                createActionIntent(context, 102, "voice")
        );
        views.setOnClickPendingIntent(
                R.id.widget_btn_scan,
                createActionIntent(context, 103, "scan")
        );

        appWidgetManager.updateAppWidget(appWidgetId, views);
    }

    private static PendingIntent createActionIntent(Context context, int requestCode, String action) {
        Intent intent = new Intent(context, MainActivity.class);
        intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        if (action != null && !action.isEmpty()) {
            intent.putExtra(EXTRA_QUICK_ACTION, action);
        }
        return PendingIntent.getActivity(
                context,
                requestCode,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }
}
