package digital.asisten.keuangan;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Rect;
import android.graphics.pdf.PdfRenderer;
import android.os.ParcelFileDescriptor;
import android.util.Base64;
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
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "LocalOcr")
public class LocalOcrPlugin extends Plugin {
    private static final int MAX_IMAGE_DIMENSION = 2200;
    private static final int MAX_PDF_PAGES_LIMIT = 30;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

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

    /**
     * Groups ML Kit lines into horizontal visual rows (left-to-right within a row)
     * so two-column bank statements and paylater summaries stay paired on the same line.
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

        for (Text.Line line : lines) {
            Rect box = line.getBoundingBox();
            int cy = box != null ? box.centerY() : rowAnchorY;
            int h = box != null ? Math.max(12, box.height()) : 20;

            if (currentRow.isEmpty()) {
                currentRow.add(line);
                rowAnchorY = cy;
                rowAnchorHeight = h;
                continue;
            }

            int tolerance = Math.max(10, Math.round(Math.min(rowAnchorHeight, h) * 0.65f));
            if (Math.abs(cy - rowAnchorY) <= tolerance) {
                currentRow.add(line);
            } else {
                rows.add(currentRow);
                currentRow = new ArrayList<>();
                currentRow.add(line);
                rowAnchorY = cy;
                rowAnchorHeight = h;
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

    private static String safeErrorMessage(Exception e) {
        if (e.getCause() != null && e.getCause().getMessage() != null) {
            return e.getCause().getMessage();
        }
        return e.getMessage() != null ? e.getMessage() : "Kesalahan tidak diketahui";
    }
}
