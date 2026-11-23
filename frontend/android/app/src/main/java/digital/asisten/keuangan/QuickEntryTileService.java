package digital.asisten.keuangan;

import android.annotation.SuppressLint;
import android.app.PendingIntent;
import android.content.Intent;
import android.graphics.drawable.Icon;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * Android Quick Settings Tile for 1-tap voice / quick expense capture from the notification shade.
 */
public class QuickEntryTileService extends TileService {

    @Override
    public void onStartListening() {
        super.onStartListening();
        Tile tile = getQsTile();
        if (tile == null) {
            return;
        }
        tile.setState(Tile.STATE_ACTIVE);
        tile.setLabel("Catat Cepat");
        tile.setIcon(Icon.createWithResource(this, R.drawable.ic_tile_quick_entry));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            tile.setSubtitle("Suara / Struk");
        }
        tile.updateTile();
    }

    @Override
    public void onClick() {
        super.onClick();
        Intent intent = new Intent(this, MainActivity.class);
        intent.setFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_CLEAR_TOP
                        | Intent.FLAG_ACTIVITY_SINGLE_TOP
        );
        intent.putExtra(FinanceSummaryWidgetProvider.EXTRA_QUICK_ACTION, "voice");

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            PendingIntent pendingIntent = PendingIntent.getActivity(
                    this,
                    201,
                    intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );
            startActivityAndCollapse(pendingIntent);
        } else {
            launchLegacyIntent(intent);
        }
    }

    @SuppressLint("StartActivityAndCollapseDeprecated")
    @SuppressWarnings("deprecation")
    private void launchLegacyIntent(Intent intent) {
        startActivityAndCollapse(intent);
    }
}
