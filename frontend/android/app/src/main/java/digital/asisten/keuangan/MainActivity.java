package digital.asisten.keuangan;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalOcrPlugin.class);
        super.onCreate(savedInstanceState);
        LocalOcrPlugin.handleIncomingIntent(this, getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        LocalOcrPlugin.handleIncomingIntent(this, intent);
    }
}
