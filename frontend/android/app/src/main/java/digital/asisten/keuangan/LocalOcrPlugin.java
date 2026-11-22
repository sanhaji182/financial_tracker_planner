package digital.asisten.keuangan;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
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
import android.media.ExifInterface;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import android.util.Base64;
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
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "LocalOcr")
public class LocalOcrPlugin extends Plugin {
    private static final int MAX_IMAGE_DIMENSION = 2200;
    private static final int MAX_PDF_PAGES_LIMIT = 30;
    private static final int MAX_SHARED_FILES = 10;
    private static final int MAX_SHARED_FILE_BYTES = 15 * 1024 * 1024;
    private static final String SHARE_CONSUMED_EXTRA = "kb_share_consumed";

    private static final List<JSObject> PENDING_SHARES =
            Collections.synchronizedList(new ArrayList<>());
    private static final ExecutorService SHARE_EXECUTOR = Executors.newSingleThreadExecutor();
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
                if (compactText.length() < 20 || !compactText.matches(".*\\d.*")) {
                    try {
                        enhancedBitmap = createHighContrastGrayscaleBitmap(bitmap);
                        InputImage enhancedImage = InputImage.fromBitmap(enhancedBitmap, 0);
                        Text retryResult = Tasks.await(recognizer.process(enhancedImage));
                        String retryText = extractRowOrderedText(retryResult);
                        String compactRetry = retryText.replaceAll("\\s+", "");
                        boolean firstHasDigits = compactText.matches(".*\\d.*");
                        boolean retryHasDigits = compactRetry.matches(".*\\d.*");
                        if ((!firstHasDigits && retryHasDigits)
                                || (compactRetry.length() > compactText.length() && (retryHasDigits || !firstHasDigits))) {
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
            int tolerance = Math.max(horizontallySeparate ? 14 : 10, Math.round(refHeight * factor));
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

    private static String safeErrorMessage(Exception e) {
        if (e.getCause() != null && e.getCause().getMessage() != null) {
            return e.getCause().getMessage();
        }
        return e.getMessage() != null ? e.getMessage() : "Kesalahan tidak diketahui";
    }
}
