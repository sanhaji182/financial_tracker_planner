package digital.asisten.keuangan;

import android.app.KeyguardManager;
import android.content.ClipData;
import android.content.ComponentName;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Matrix;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.pdf.PdfRenderer;
import android.hardware.biometrics.BiometricManager;
import android.hardware.biometrics.BiometricPrompt;
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.provider.Settings;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.text.TextUtils;
import android.util.Base64;
import android.view.Window;
import android.view.WindowManager;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "LocalOcr")
public class LocalOcrPlugin extends Plugin {
    private static final int MAX_IMAGE_DIMENSION = 2200;
    private static final int MAX_PDF_PAGES_LIMIT = 30;
    private static final int MAX_SHARED_FILES = 10;
    private static final int MAX_SHARED_FILE_BYTES = 15 * 1024 * 1024;
    private static final String SHARE_CONSUMED_EXTRA = "kb_share_consumed";
    private static final String QUICK_CONSUMED_EXTRA = "kb_quick_consumed";
    private static final String SECURE_VAULT_PREFS = "kb_secure_vault";
    private static final String KEYSTORE_ALIAS = "kb_master_keystore_key_v1";
    private static final String ANDROID_KEYSTORE = "AndroidKeyStore";
    private static final String AES_GCM_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_IV_LENGTH = 12;
    private static final int GCM_TAG_LENGTH_BITS = 128;

    private static final List<JSObject> PENDING_SHARES =
            Collections.synchronizedList(new ArrayList<>());
    private static final ExecutorService SHARE_EXECUTOR = Executors.newSingleThreadExecutor();
    private static volatile String pendingQuickAction = null;
    private static volatile LocalOcrPlugin activeInstance;

    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    private static final class PendingStreamSource {
        final InputStream stream;
        final String mimeType;
        final String fileName;

        PendingStreamSource(InputStream stream, String mimeType, String fileName) {
            this.stream = stream;
            this.mimeType = mimeType;
            this.fileName = fileName;
        }
    }

    @Override
    public void load() {
        super.load();
        activeInstance = this;
    }

    @Override
    protected void handleOnDestroy() {
        if (activeInstance == this) {
            activeInstance = null;
        }
        super.handleOnDestroy();
    }

    public static void handleIncomingIntent(Context context, Intent intent) {
        if (context == null || intent == null) {
            return;
        }

        String quickAction = intent.getStringExtra(FinanceSummaryWidgetProvider.EXTRA_QUICK_ACTION);
        if (quickAction != null && !quickAction.trim().isEmpty()
                && !intent.getBooleanExtra(QUICK_CONSUMED_EXTRA, false)) {
            intent.putExtra(QUICK_CONSUMED_EXTRA, true);
            pendingQuickAction = quickAction.trim();
            final JSObject quickPayload = new JSObject();
            quickPayload.put("action", pendingQuickAction);
            new Handler(Looper.getMainLooper()).post(() -> {
                LocalOcrPlugin live = activeInstance;
                if (live != null) {
                    live.notifyListeners("quickActionReceived", quickPayload);
                }
            });
        }

        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            return;
        }

        if (intent.getBooleanExtra(SHARE_CONSUMED_EXTRA, false)) {
            return;
        }
        intent.putExtra(SHARE_CONSUMED_EXTRA, true);

        final String extraText = combineExtraText(
                intent.getStringExtra(Intent.EXTRA_SUBJECT),
                intent.getStringExtra(Intent.EXTRA_TEXT)
        );
        final String intentType = intent.getType();
        final List<Uri> uris = extractUrisFromIntent(intent);
        final ContentResolver resolver = context.getContentResolver();
        final List<PendingStreamSource> sources = new ArrayList<>();

        int limit = Math.min(uris.size(), MAX_SHARED_FILES);
        for (int i = 0; i < limit; i++) {
            Uri uri = uris.get(i);
            if (uri == null) {
                continue;
            }
            try {
                InputStream stream = resolver.openInputStream(uri);
                if (stream == null) {
                    continue;
                }
                String mimeType = resolveMimeType(resolver, uri, intentType);
                String fileName = resolveFileName(resolver, uri, mimeType, i + 1);
                sources.add(new PendingStreamSource(stream, mimeType, fileName));
            } catch (Exception ignored) {
            }
        }

        if (sources.isEmpty() && extraText.isEmpty()) {
            return;
        }

        SHARE_EXECUTOR.execute(() -> {
            List<JSObject> extracted = new ArrayList<>();
            for (PendingStreamSource source : sources) {
                try {
                    byte[] bytes = readBytesLimited(source.stream, MAX_SHARED_FILE_BYTES);
                    if (bytes == null || bytes.length == 0) {
                        continue;
                    }
                    JSObject item = new JSObject();
                    item.put("id", "share-" + UUID.randomUUID().toString());
                    item.put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
                    item.put("mimeType", source.mimeType);
                    item.put("fileName", source.fileName);
                    if (!extraText.isEmpty()) {
                        item.put("extraText", extraText);
                    }
                    extracted.add(item);
                } catch (Exception ignored) {
                } finally {
                    try {
                        source.stream.close();
                    } catch (Exception ignored) {
                    }
                }
            }

            if (extracted.isEmpty() && !extraText.isEmpty()) {
                JSObject textItem = new JSObject();
                textItem.put("id", "share-" + UUID.randomUUID().toString());
                textItem.put(
                        "base64",
                        Base64.encodeToString(
                                extraText.getBytes(StandardCharsets.UTF_8),
                                Base64.NO_WRAP
                        )
                );
                textItem.put("mimeType", "text/plain");
                textItem.put("fileName", "shared-receipt.txt");
                textItem.put("extraText", extraText);
                extracted.add(textItem);
            }

            if (extracted.isEmpty()) {
                return;
            }

            PENDING_SHARES.addAll(extracted);

            final JSArray files = new JSArray();
            for (JSObject item : extracted) {
                files.put(item);
            }
            final JSObject payload = new JSObject();
            payload.put("files", files);

            new Handler(Looper.getMainLooper()).post(() -> {
                LocalOcrPlugin live = activeInstance;
                if (live != null) {
                    live.notifyListeners("sharedFilesReceived", payload);
                }
            });
        });
    }

    @PluginMethod
    public void consumePendingShares(PluginCall call) {
        SHARE_EXECUTOR.execute(() -> {
            JSArray files = new JSArray();
            synchronized (PENDING_SHARES) {
                for (JSObject item : PENDING_SHARES) {
                    files.put(item);
                }
                PENDING_SHARES.clear();
            }
            JSObject ret = new JSObject();
            ret.put("files", files);
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("available", true);
        ret.put("engine", "mlkit-text-recognition");
        call.resolve(ret);
    }

    @PluginMethod
    public void recognizeImage(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.trim().isEmpty()) {
            call.reject("Data gambar base64 wajib diisi.");
            return;
        }

        executor.execute(() -> {
            Bitmap bitmap = null;
            Bitmap enhancedBitmap = null;
            TextRecognizer recognizer = null;
            try {
                byte[] bytes = decodeBase64Payload(base64);
                bitmap = decodeScaledBitmap(bytes);
                if (bitmap == null) {
                    call.reject("Gagal membaca gambar untuk OCR.");
                    return;
                }

                recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
                InputImage image = InputImage.fromBitmap(bitmap, 0);
                Text result = Tasks.await(recognizer.process(image));
                String text = extractRowOrderedText(result);

                String compactText = text.replaceAll("\\s+", "");
                boolean initialHasMoneySignal = hasMoneyOrTotalSignal(text);
                if (compactText.length() < 20 || !compactText.matches(".*\\d.*") || !initialHasMoneySignal) {
                    try {
                        enhancedBitmap = createHighContrastGrayscaleBitmap(bitmap);
                        InputImage enhancedImage = InputImage.fromBitmap(enhancedBitmap, 0);
                        Text retryResult = Tasks.await(recognizer.process(enhancedImage));
                        String retryText = extractRowOrderedText(retryResult);
                        String compactRetry = retryText.replaceAll("\\s+", "");
                        boolean firstHasDigits = compactText.matches(".*\\d.*");
                        boolean retryHasDigits = compactRetry.matches(".*\\d.*");
                        boolean retryHasMoneySignal = hasMoneyOrTotalSignal(retryText);
                        if ((!initialHasMoneySignal && retryHasMoneySignal)
                                || (!firstHasDigits && retryHasDigits)
                                || (compactRetry.length() > compactText.length()
                                        && (retryHasDigits || !firstHasDigits)
                                        && (!initialHasMoneySignal || retryHasMoneySignal))) {
                            text = retryText;
                        }
                    } catch (Exception ignored) {
                    }
                }

                JSObject ret = new JSObject();
                ret.put("text", text);
                ret.put("pageCount", 1);
                ret.put("engine", "mlkit");
                call.resolve(ret);
            } catch (Exception e) {
                call.reject("Gagal menjalankan OCR offline: " + safeErrorMessage(e), e);
            } finally {
                if (recognizer != null) {
                    try {
                        recognizer.close();
                    } catch (Exception ignored) {
                    }
                }
                if (enhancedBitmap != null && !enhancedBitmap.isRecycled()) {
                    enhancedBitmap.recycle();
                }
                if (bitmap != null && !bitmap.isRecycled()) {
                    bitmap.recycle();
                }
            }
        });
    }

    @PluginMethod
    public void recognizePdf(PluginCall call) {
        String base64 = call.getString("base64");
        if (base64 == null || base64.trim().isEmpty()) {
            call.reject("Data PDF base64 wajib diisi.");
            return;
        }

        int requestedMaxPages = call.getInt("maxPages", 15);
        int maxPages = Math.max(1, Math.min(requestedMaxPages, MAX_PDF_PAGES_LIMIT));

        executor.execute(() -> {
            File tempFile = null;
            ParcelFileDescriptor pfd = null;
            PdfRenderer renderer = null;
            TextRecognizer recognizer = null;

            try {
                byte[] bytes = decodeBase64Payload(base64);
                tempFile = File.createTempFile("kb_ocr_", ".pdf", getContext().getCacheDir());
                try (FileOutputStream fos = new FileOutputStream(tempFile)) {
                    fos.write(bytes);
                    fos.flush();
                }

                pfd = ParcelFileDescriptor.open(tempFile, ParcelFileDescriptor.MODE_READ_ONLY);
                renderer = new PdfRenderer(pfd);
                recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);

                int totalPages = renderer.getPageCount();
                int pagesToRead = Math.min(totalPages, maxPages);
                StringBuilder combined = new StringBuilder();

                for (int i = 0; i < pagesToRead; i++) {
                    PdfRenderer.Page page = null;
                    Bitmap bitmap = null;
                    try {
                        page = renderer.openPage(i);
                        int pageWidth = Math.max(1, page.getWidth());
                        int pageHeight = Math.max(1, page.getHeight());
                        float scale = 2.0f;
                        int maxDim = Math.max(pageWidth, pageHeight);
                        if (maxDim * scale > MAX_IMAGE_DIMENSION) {
                            scale = (float) MAX_IMAGE_DIMENSION / (float) maxDim;
                        }

                        int targetWidth = Math.max(1, Math.round(pageWidth * scale));
                        int targetHeight = Math.max(1, Math.round(pageHeight * scale));

                        bitmap = Bitmap.createBitmap(targetWidth, targetHeight, Bitmap.Config.ARGB_8888);
                        Canvas canvas = new Canvas(bitmap);
                        canvas.drawColor(Color.WHITE);
                        page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY);

                        InputImage image = InputImage.fromBitmap(bitmap, 0);
                        Text result = Tasks.await(recognizer.process(image));
                        String pageText = extractRowOrderedText(result);
                        if (!pageText.isEmpty()) {
                            if (combined.length() > 0) {
                                combined.append("\n\n");
                            }
                            combined.append(pageText);
                        }
                    } finally {
                        if (page != null) {
                            try {
                                page.close();
                            } catch (Exception ignored) {
                            }
                        }
                        if (bitmap != null && !bitmap.isRecycled()) {
                            bitmap.recycle();
                        }
                    }
                }

                JSObject ret = new JSObject();
                ret.put("text", combined.toString());
                ret.put("pageCount", pagesToRead);
                ret.put("totalPages", totalPages);
                ret.put("engine", "mlkit-pdf");
                call.resolve(ret);
            } catch (SecurityException se) {
                call.reject("PDF_PASSWORD_REQUIRED", se);
            } catch (Exception e) {
                String msg = safeErrorMessage(e);
                if (msg.toLowerCase().contains("password")) {
                    call.reject("PDF_PASSWORD_REQUIRED", e);
                } else {
                    call.reject("Gagal membaca PDF secara offline: " + msg, e);
                }
            } finally {
                if (recognizer != null) {
                    try {
                        recognizer.close();
                    } catch (Exception ignored) {
                    }
                }
                if (renderer != null) {
                    try {
                        renderer.close();
                    } catch (Exception ignored) {
                            }
                }
                if (pfd != null) {
                    try {
                        pfd.close();
                    } catch (Exception ignored) {
                    }
                }
                if (tempFile != null && tempFile.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    tempFile.delete();
                }
            }
        });
    }

    private static byte[] decodeBase64Payload(String input) {
        String clean = input.trim();
        int commaIdx = clean.indexOf(',');
        if (commaIdx >= 0) {
            clean = clean.substring(commaIdx + 1);
        }
        return Base64.decode(clean, Base64.DEFAULT);
    }

    private static Bitmap decodeScaledBitmap(byte[] bytes) {
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeByteArray(bytes, 0, bytes.length, bounds);

        int inSampleSize = 1;
        int maxDim = Math.max(bounds.outWidth, bounds.outHeight);
        while (maxDim / inSampleSize > MAX_IMAGE_DIMENSION) {
            inSampleSize *= 2;
        }

        BitmapFactory.Options opts = new BitmapFactory.Options();
        opts.inSampleSize = inSampleSize;
        opts.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.length, opts);
        if (decoded == null) {
            return null;
        }

        decoded = applyExifOrientation(decoded, bytes);

        // Flatten alpha channel onto white canvas so transparent PNG receipts stay legible
        if (decoded.hasAlpha()) {
            Bitmap opaque = Bitmap.createBitmap(decoded.getWidth(), decoded.getHeight(), Bitmap.Config.ARGB_8888);
            Canvas canvas = new Canvas(opaque);
            canvas.drawColor(Color.WHITE);
            canvas.drawBitmap(decoded, 0f, 0f, null);
            decoded.recycle();
            return opaque;
        }
        return decoded;
    }

    private static Bitmap applyExifOrientation(Bitmap bitmap, byte[] bytes) {
        try {
            ExifInterface exif = new ExifInterface(new ByteArrayInputStream(bytes));
            int orientation = exif.getAttributeInt(
                    ExifInterface.TAG_ORIENTATION,
                    ExifInterface.ORIENTATION_NORMAL
            );
            Matrix matrix = new Matrix();
            switch (orientation) {
                case ExifInterface.ORIENTATION_ROTATE_90:
                    matrix.postRotate(90f);
                    break;
                case ExifInterface.ORIENTATION_ROTATE_180:
                    matrix.postRotate(180f);
                    break;
                case ExifInterface.ORIENTATION_ROTATE_270:
                    matrix.postRotate(270f);
                    break;
                case ExifInterface.ORIENTATION_FLIP_HORIZONTAL:
                    matrix.preScale(-1f, 1f);
                    break;
                case ExifInterface.ORIENTATION_FLIP_VERTICAL:
                    matrix.preScale(1f, -1f);
                    break;
                case ExifInterface.ORIENTATION_TRANSPOSE:
                    matrix.postRotate(90f);
                    matrix.preScale(-1f, 1f);
                    break;
                case ExifInterface.ORIENTATION_TRANSVERSE:
                    matrix.postRotate(270f);
                    matrix.preScale(-1f, 1f);
                    break;
                default:
                    return bitmap;
            }
            Bitmap rotated = Bitmap.createBitmap(
                    bitmap, 0, 0, bitmap.getWidth(), bitmap.getHeight(), matrix, true
            );
            if (rotated != bitmap) {
                bitmap.recycle();
            }
            return rotated;
        } catch (Exception ignored) {
            return bitmap;
        }
    }

    private static Bitmap createHighContrastGrayscaleBitmap(Bitmap src) {
        int width = Math.max(1, src.getWidth());
        int height = Math.max(1, src.getHeight());
        Bitmap out = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(out);

        ColorMatrix grayMatrix = new ColorMatrix();
        grayMatrix.setSaturation(0f);

        float contrast = 1.45f;
        float translate = -35f;
        ColorMatrix contrastMatrix = new ColorMatrix(new float[] {
                contrast, 0f, 0f, 0f, translate,
                0f, contrast, 0f, 0f, translate,
                0f, 0f, contrast, 0f, translate,
                0f, 0f, 0f, 1f, 0f
        });
        grayMatrix.postConcat(contrastMatrix);

        Paint paint = new Paint();
        paint.setColorFilter(new ColorMatrixColorFilter(grayMatrix));
        canvas.drawBitmap(src, 0f, 0f, paint);
        return out;
    }

    private static boolean hasMoneyOrTotalSignal(String text) {
        if (text == null || text.trim().isEmpty()) {
            return false;
        }
        return text.matches(
                "(?is).*(?:total|bayar|jumlah|nominal|harga\\s*jual|tunai|qris|\\b[1-9]\\d{0,2}(?:[.,]\\d{3})+).*"
        );
    }

    /**
     * Groups ML Kit lines into horizontal visual rows (left-to-right within a row)
     * so two-column bank statements and slightly tilted receipts stay paired on the same line.
     */
    private static String extractRowOrderedText(Text result) {
        List<Text.Line> lines = new ArrayList<>();
        for (Text.TextBlock block : result.getTextBlocks()) {
            lines.addAll(block.getLines());
        }
        if (lines.isEmpty()) {
            return result.getText() == null ? "" : result.getText().trim();
        }

        Collections.sort(lines, new Comparator<Text.Line>() {
            @Override
            public int compare(Text.Line a, Text.Line b) {
                Rect ra = a.getBoundingBox();
                Rect rb = b.getBoundingBox();
                int ya = ra != null ? ra.centerY() : 0;
                int yb = rb != null ? rb.centerY() : 0;
                if (ya != yb) {
                    return Integer.compare(ya, yb);
                }
                int xa = ra != null ? ra.left : 0;
                int xb = rb != null ? rb.left : 0;
                return Integer.compare(xa, xb);
            }
        });

        List<List<Text.Line>> rows = new ArrayList<>();
        List<Text.Line> currentRow = new ArrayList<>();
        int rowAnchorY = 0;
        int rowAnchorHeight = 20;
        int currentRowMaxRight = 0;

        for (Text.Line line : lines) {
            Rect box = line.getBoundingBox();
            int cy = box != null ? box.centerY() : rowAnchorY;
            int h = box != null ? Math.max(12, box.height()) : 20;
            int left = box != null ? box.left : 0;
            int right = box != null ? box.right : 0;

            if (currentRow.isEmpty()) {
                currentRow.add(line);
                rowAnchorY = cy;
                rowAnchorHeight = h;
                currentRowMaxRight = right;
                continue;
            }

            boolean horizontallySeparate = box != null && left > (currentRowMaxRight - 20);
            float factor = horizontallySeparate ? 0.95f : 0.65f;
            int refHeight = horizontallySeparate
                    ? Math.max(rowAnchorHeight, h)
                    : Math.min(rowAnchorHeight, h);
            int tiltPadding = horizontallySeparate
                    ? Math.min(45, Math.round(Math.max(0, left - currentRowMaxRight) * 0.08f))
                    : 0;
            int tolerance = Math.max(horizontallySeparate ? 14 : 10, Math.round(refHeight * factor) + tiltPadding);
            if (Math.abs(cy - rowAnchorY) <= tolerance) {
                currentRow.add(line);
                currentRowMaxRight = Math.max(currentRowMaxRight, right);
            } else {
                rows.add(currentRow);
                currentRow = new ArrayList<>();
                currentRow.add(line);
                rowAnchorY = cy;
                rowAnchorHeight = h;
                currentRowMaxRight = right;
            }
        }
        if (!currentRow.isEmpty()) {
            rows.add(currentRow);
        }

        StringBuilder out = new StringBuilder();
        for (List<Text.Line> row : rows) {
            Collections.sort(row, new Comparator<Text.Line>() {
                @Override
                public int compare(Text.Line a, Text.Line b) {
                    Rect ra = a.getBoundingBox();
                    Rect rb = b.getBoundingBox();
                    int xa = ra != null ? ra.left : 0;
                    int xb = rb != null ? rb.left : 0;
                    return Integer.compare(xa, xb);
                }
            });

            StringBuilder lineText = new StringBuilder();
            for (Text.Line item : row) {
                String txt = item.getText().trim();
                if (txt.isEmpty()) {
                    continue;
                }
                if (lineText.length() > 0) {
                    lineText.append("   ");
                }
                lineText.append(txt);
            }
            if (lineText.length() > 0) {
                if (out.length() > 0) {
                    out.append('\n');
                }
                out.append(lineText);
            }
        }

        return out.toString().trim();
    }

    private static String combineExtraText(String subject, String text) {
        StringBuilder sb = new StringBuilder();
        if (subject != null && !subject.trim().isEmpty()) {
            sb.append(subject.trim());
        }
        if (text != null && !text.trim().isEmpty()) {
            if (sb.length() > 0) {
                sb.append('\n');
            }
            sb.append(text.trim());
        }
        return sb.toString();
    }

    @SuppressWarnings("deprecation")
    private static List<Uri> extractUrisFromIntent(Intent intent) {
        List<Uri> uris = new ArrayList<>();
        String action = intent.getAction();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri single = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ? intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri.class)
                    : intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (single != null) {
                uris.add(single);
            }
        } else if (Intent.ACTION_SEND_MULTIPLE.equals(action)) {
            ArrayList<Uri> multi = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                    ? intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri.class)
                    : intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (multi != null) {
                for (Uri u : multi) {
                    if (u != null) {
                        uris.add(u);
                    }
                }
            }
        }

        if (uris.isEmpty() && intent.getClipData() != null) {
            ClipData clipData = intent.getClipData();
            for (int i = 0; i < clipData.getItemCount(); i++) {
                Uri clipUri = clipData.getItemAt(i).getUri();
                if (clipUri != null) {
                    uris.add(clipUri);
                }
            }
        }
        return uris;
    }

    private static String resolveMimeType(ContentResolver resolver, Uri uri, String fallback) {
        try {
            String detected = resolver.getType(uri);
            if (detected != null && !detected.trim().isEmpty()) {
                return detected;
            }
        } catch (Exception ignored) {
        }
        if (fallback != null && !fallback.trim().isEmpty() && !"*/*".equals(fallback)) {
            return fallback;
        }
        return "image/jpeg";
    }

    private static String resolveFileName(
            ContentResolver resolver, Uri uri, String mimeType, int index) {
        try (Cursor cursor = resolver.query(
                uri, new String[] {OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    String name = cursor.getString(idx);
                    if (name != null && !name.trim().isEmpty()) {
                        return name.trim();
                    }
                }
            }
        } catch (Exception ignored) {
        }
        String ext = mimeType != null && mimeType.contains("pdf")
                ? ".pdf"
                : mimeType != null && mimeType.contains("png") ? ".png" : ".jpg";
        return "qris-share-" + System.currentTimeMillis() + "-" + index + ext;
    }

    private static byte[] readBytesLimited(InputStream stream, int maxBytes) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buffer = new byte[16384];
        int total = 0;
        int read;
        while ((read = stream.read(buffer)) != -1) {
            if (total + read > maxBytes) {
                out.write(buffer, 0, Math.max(0, maxBytes - total));
                break;
            }
            out.write(buffer, 0, read);
            total += read;
        }
        return out.toByteArray();
    }

    @PluginMethod
    public void setSystemBarColors(PluginCall call) {
        String colorHex = call.getString("color", "#090D16");
        boolean isDark = Boolean.TRUE.equals(call.getBoolean("dark", false));
        AppCompatActivity activity = getActivity();
        if (activity == null) {
            call.resolve();
            return;
        }
        activity.runOnUiThread(() -> {
            try {
                int parsedColor = Color.parseColor(colorHex);
                Window window = activity.getWindow();
                window.getDecorView().setBackgroundColor(parsedColor);
                window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
                window.setStatusBarColor(parsedColor);
                window.setNavigationBarColor(parsedColor);
                WindowInsetsControllerCompat insetsController =
                        WindowCompat.getInsetsController(window, window.getDecorView());
                insetsController.setAppearanceLightStatusBars(!isDark);
                insetsController.setAppearanceLightNavigationBars(!isDark);
            } catch (Exception ignored) {
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void setSecureItem(PluginCall call) {
        String key = call.getString("key", "");
        String value = call.getString("value", "");
        if (key == null || key.trim().isEmpty()) {
            call.reject("Key wajib diisi.");
            return;
        }
        try {
            SecretKey secretKey = getOrCreateKeystoreSecretKey();
            Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            byte[] iv = cipher.getIV();
            byte[] encrypted = cipher.doFinal((value != null ? value : "").getBytes(StandardCharsets.UTF_8));
            byte[] combined = new byte[iv.length + encrypted.length];
            System.arraycopy(iv, 0, combined, 0, iv.length);
            System.arraycopy(encrypted, 0, combined, iv.length, encrypted.length);

            SharedPreferences prefs = getContext().getSharedPreferences(SECURE_VAULT_PREFS, Context.MODE_PRIVATE);
            prefs.edit().putString(key.trim(), Base64.encodeToString(combined, Base64.NO_WRAP)).apply();
            JSObject ret = new JSObject();
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Gagal menyimpan rahasia terenkripsi: " + safeErrorMessage(e));
        }
    }

    @PluginMethod
    public void getSecureItem(PluginCall call) {
        String key = call.getString("key", "");
        if (key == null || key.trim().isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("value", JSObject.NULL);
            call.resolve(ret);
            return;
        }
        try {
            SharedPreferences prefs = getContext().getSharedPreferences(SECURE_VAULT_PREFS, Context.MODE_PRIVATE);
            String encoded = prefs.getString(key.trim(), null);
            if (encoded == null || encoded.isEmpty()) {
                JSObject ret = new JSObject();
                ret.put("value", JSObject.NULL);
                call.resolve(ret);
                return;
            }
            byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
            if (combined.length <= GCM_IV_LENGTH) {
                JSObject ret = new JSObject();
                ret.put("value", JSObject.NULL);
                call.resolve(ret);
                return;
            }
            byte[] iv = new byte[GCM_IV_LENGTH];
            byte[] cipherBytes = new byte[combined.length - GCM_IV_LENGTH];
            System.arraycopy(combined, 0, iv, 0, GCM_IV_LENGTH);
            System.arraycopy(combined, GCM_IV_LENGTH, cipherBytes, 0, cipherBytes.length);

            SecretKey secretKey = getOrCreateKeystoreSecretKey();
            Cipher cipher = Cipher.getInstance(AES_GCM_TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv));
            String decrypted = new String(cipher.doFinal(cipherBytes), StandardCharsets.UTF_8);
            JSObject ret = new JSObject();
            ret.put("value", decrypted);
            call.resolve(ret);
        } catch (Exception e) {
            JSObject ret = new JSObject();
            ret.put("value", JSObject.NULL);
            call.resolve(ret);
        }
    }

    @PluginMethod
    public void removeSecureItem(PluginCall call) {
        String key = call.getString("key", "");
        if (key != null && !key.trim().isEmpty()) {
            SharedPreferences prefs = getContext().getSharedPreferences(SECURE_VAULT_PREFS, Context.MODE_PRIVATE);
            prefs.edit().remove(key.trim()).apply();
        }
        JSObject ret = new JSObject();
        ret.put("removed", true);
        call.resolve(ret);
    }

    private static SecretKey getOrCreateKeystoreSecretKey() throws Exception {
        KeyStore ks = KeyStore.getInstance(ANDROID_KEYSTORE);
        ks.load(null);
        if (ks.containsAlias(KEYSTORE_ALIAS)) {
            KeyStore.Entry entry = ks.getEntry(KEYSTORE_ALIAS, null);
            if (entry instanceof KeyStore.SecretKeyEntry) {
                return ((KeyStore.SecretKeyEntry) entry).getSecretKey();
            }
        }
        KeyGenerator keyGen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE);
        KeyGenParameterSpec spec = new KeyGenParameterSpec.Builder(
                KEYSTORE_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build();
        keyGen.init(spec);
        return keyGen.generateKey();
    }

    @PluginMethod
    public void isBiometricAvailable(PluginCall call) {
        boolean available = false;
        try {
            Context ctx = getContext();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                BiometricManager bm = ctx.getSystemService(BiometricManager.class);
                if (bm != null) {
                    int auth = BiometricManager.Authenticators.BIOMETRIC_STRONG
                            | BiometricManager.Authenticators.BIOMETRIC_WEAK
                            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
                    int canAuth = bm.canAuthenticate(auth);
                    available = canAuth == BiometricManager.BIOMETRIC_SUCCESS;
                }
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                KeyguardManager km = (KeyguardManager) ctx.getSystemService(Context.KEYGUARD_SERVICE);
                available = km != null && km.isDeviceSecure();
            }
        } catch (Exception ignored) {
            available = false;
        }
        JSObject ret = new JSObject();
        ret.put("available", available);
        call.resolve(ret);
    }

    @PluginMethod
    public void authenticateBiometric(PluginCall call) {
        AppCompatActivity activity = getActivity();
        if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.P) {
            JSObject ret = new JSObject();
            ret.put("authenticated", false);
            ret.put("reason", "unavailable");
            call.resolve(ret);
            return;
        }

        String title = call.getString("title", "Buka Keuangan Bersama");
        String subtitle = call.getString("subtitle", "Verifikasi identitas perangkat Anda");

        activity.runOnUiThread(() -> {
            final AtomicBoolean finished = new AtomicBoolean(false);
            try {
                BiometricPrompt.Builder builder = new BiometricPrompt.Builder(activity)
                        .setTitle(title != null ? title : "Buka Keuangan Bersama")
                        .setSubtitle(subtitle != null ? subtitle : "Verifikasi perangkat");

                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    int authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG
                            | BiometricManager.Authenticators.BIOMETRIC_WEAK
                            | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
                    builder.setAllowedAuthenticators(authenticators);
                } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    @SuppressWarnings("deprecation")
                    BiometricPrompt.Builder ignored = builder.setDeviceCredentialAllowed(true);
                } else {
                    builder.setNegativeButton(
                            "Gunakan PIN",
                            ContextCompat.getMainExecutor(activity),
                            (dialog, which) -> resolveBiometricResult(call, finished, false, "cancelled")
                    );
                }

                BiometricPrompt prompt = builder.build();
                CancellationSignal signal = new CancellationSignal();
                prompt.authenticate(
                        signal,
                        ContextCompat.getMainExecutor(activity),
                        new BiometricPrompt.AuthenticationCallback() {
                            @Override
                            public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult result) {
                                resolveBiometricResult(call, finished, true, null);
                            }

                            @Override
                            public void onAuthenticationError(int errorCode, CharSequence errString) {
                                String reason = errorCode == BiometricPrompt.BIOMETRIC_ERROR_USER_CANCELED
                                        || errorCode == BiometricPrompt.BIOMETRIC_ERROR_CANCELED
                                        ? "cancelled"
                                        : "error";
                                resolveBiometricResult(call, finished, false, reason);
                            }

                            @Override
                            public void onAuthenticationFailed() {
                                // Prompt stays open for retry
                            }
                        }
                );
            } catch (Exception e) {
                resolveBiometricResult(call, finished, false, "error");
            }
        });
    }

    private static void resolveBiometricResult(
            PluginCall call, AtomicBoolean finished, boolean ok, String reason) {
        if (!finished.compareAndSet(false, true)) {
            return;
        }
        JSObject ret = new JSObject();
        ret.put("authenticated", ok);
        if (reason != null) {
            ret.put("reason", reason);
        }
        call.resolve(ret);
    }

    private boolean isNotificationListenerGranted() {
        try {
            Context ctx = getContext();
            String flat = Settings.Secure.getString(ctx.getContentResolver(), "enabled_notification_listeners");
            if (TextUtils.isEmpty(flat)) {
                return false;
            }
            ComponentName cn = BankNotificationListenerService.getComponentName(ctx);
            return flat.contains(cn.flattenToString()) || flat.contains(ctx.getPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void getNotificationCaptureStatus(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(
                BankNotificationListenerService.PREFS_NAME, Context.MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(BankNotificationListenerService.KEY_ENABLED, false);
        int pendingCount = 0;
        try {
            JSONArray arr = new JSONArray(prefs.getString(BankNotificationListenerService.KEY_BUFFER, "[]"));
            pendingCount = arr.length();
        } catch (Exception ignored) {
        }
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        ret.put("permissionGranted", isNotificationListenerGranted());
        ret.put("pendingCount", pendingCount);
        call.resolve(ret);
    }

    @PluginMethod
    public void setNotificationCaptureEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        SharedPreferences prefs = getContext().getSharedPreferences(
                BankNotificationListenerService.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(BankNotificationListenerService.KEY_ENABLED, enabled).apply();
        JSObject ret = new JSObject();
        ret.put("enabled", enabled);
        ret.put("permissionGranted", isNotificationListenerGranted());
        call.resolve(ret);
    }

    @PluginMethod
    public void openNotificationListenerSettings(PluginCall call) {
        try {
            Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
        } catch (Exception ignored) {
        }
        call.resolve();
    }

    @PluginMethod
    public void consumeCapturedNotifications(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(
                BankNotificationListenerService.PREFS_NAME, Context.MODE_PRIVATE);
        JSArray out = new JSArray();
        try {
            String raw = prefs.getString(BankNotificationListenerService.KEY_BUFFER, "[]");
            JSONArray arr = new JSONArray(raw);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject obj = arr.optJSONObject(i);
                if (obj != null) {
                    out.put(JSObject.fromJSONObject(obj));
                }
            }
            prefs.edit().putString(BankNotificationListenerService.KEY_BUFFER, "[]").apply();
        } catch (Exception ignored) {
        }
        JSObject ret = new JSObject();
        ret.put("notifications", out);
        call.resolve(ret);
    }

    public static void emitCapturedNotificationsUpdated(int count) {
        JSObject payload = new JSObject();
        payload.put("count", count);
        new Handler(Looper.getMainLooper()).post(() -> {
            LocalOcrPlugin live = activeInstance;
            if (live != null) {
                live.notifyListeners("capturedNotificationsUpdated", payload);
            }
        });
    }

    @PluginMethod
    public void updateWidgetSummary(PluginCall call) {
        boolean masked = Boolean.TRUE.equals(call.getBoolean("privacyMasked", false));
        String safeToSpend = call.getString("safeToSpend", "Rp 0");
        String liquidCash = call.getString("liquidCash", "Rp 0");
        String netWorth = call.getString("netWorth", "Rp 0");

        Context ctx = getContext();
        SharedPreferences prefs = ctx.getSharedPreferences(
                FinanceSummaryWidgetProvider.WIDGET_PREFS, Context.MODE_PRIVATE);
        prefs.edit()
                .putString(FinanceSummaryWidgetProvider.KEY_SAFE_TO_SPEND, masked ? "Rp ••••••" : safeToSpend)
                .putString(FinanceSummaryWidgetProvider.KEY_LIQUID_CASH, masked ? "Kas Likuid: Rp ••••••" : ("Kas Likuid: " + liquidCash))
                .putString(FinanceSummaryWidgetProvider.KEY_NET_WORTH, masked ? "Rp ••••••" : netWorth)
                .putString(FinanceSummaryWidgetProvider.KEY_UPDATED_LABEL, masked ? "Mode Privasi Aktif" : "Diperbarui langsung")
                .apply();

        FinanceSummaryWidgetProvider.refreshAllWidgets(ctx);
        JSObject ret = new JSObject();
        ret.put("updated", true);
        call.resolve(ret);
    }

    @PluginMethod
    public void consumePendingQuickAction(PluginCall call) {
        String action = pendingQuickAction;
        pendingQuickAction = null;
        JSObject ret = new JSObject();
        ret.put("action", action != null ? action : JSObject.NULL);
        call.resolve(ret);
    }

    private static String safeErrorMessage(Exception e) {
        if (e.getCause() != null && e.getCause().getMessage() != null) {
            return e.getCause().getMessage();
        }
        return e.getMessage() != null ? e.getMessage() : "Kesalahan tidak diketahui";
    }
}
