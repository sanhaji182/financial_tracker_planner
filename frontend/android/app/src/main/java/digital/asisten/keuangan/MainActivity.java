package digital.asisten.keuangan;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LocalOcrPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
