package net.quizpocket.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.*;
import android.widget.Toast;
import android.database.Cursor;
import android.provider.OpenableColumns;
import org.json.JSONObject;
import java.io.IOException;
import java.io.InputStream;
import java.util.UUID;
import java.net.URLConnection;

public class QuizActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> pending;
    private static final String HOME = "https://quiz.invalid/assets/index.html";
    private static final String VOCABULARY = "https://quiz.invalid/assets/vocabulary.html";

    private static final long MAX_FILE = 32L * 1024 * 1024;
    private volatile SharedDoc shared;
    private boolean pageReady;

    private static class SharedDoc {
        final Uri uri;
        final String route = "/incoming/" + UUID.randomUUID();
        boolean offered;
        SharedDoc(Uri uri) { this.uri = uri; }
    }

    private void handleIntent(Intent intent) {
        Uri uri = null;
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Object stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (stream instanceof Uri) uri = (Uri)stream;
            else if (intent.getClipData() != null && intent.getClipData().getItemCount() > 0)
                uri = intent.getClipData().getItemAt(0).getUri();
        } else if (Intent.ACTION_VIEW.equals(intent.getAction())) uri = intent.getData();
        if (uri != null && "content".equals(uri.getScheme())) {
            shared = new SharedDoc(uri);
            if (VOCABULARY.equals(web.getUrl())) showPage(HOME);
            else if (pageReady) offerShared();
        }
    }

    private void offerShared() {
        SharedDoc doc = shared;
        if (doc == null || doc.offered) return;
        doc.offered = true;
        String name = doc.uri.getLastPathSegment();
        try (Cursor cursor = getContentResolver().query(doc.uri,
                new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE}, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int col = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (col >= 0 && !cursor.isNull(col)) name = cursor.getString(col);
                col = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (col >= 0 && cursor.getLong(col) > MAX_FILE) {
                    Toast.makeText(this, "请把题库拆分为每份 32 MB 以内再导入", Toast.LENGTH_LONG).show();
                    return;
                }
            }
        } catch (RuntimeException ignored) {}
        if (name == null || name.trim().isEmpty()) name = "题库";
        if (!name.toLowerCase(java.util.Locale.ROOT).matches(".*[.](docx?|xlsx?|html?|csv|json)$")) {
            String mime = getIntent().getType();
            if (mime == null || "application/octet-stream".equals(mime)) {
                try { mime = getContentResolver().getType(doc.uri); } catch (RuntimeException ignored) {}
            }
            String ext = mime == null ? null : android.webkit.MimeTypeMap.getSingleton().getExtensionFromMimeType(mime);
            if (ext != null && ext.matches("docx?|xlsx?|html?|csv|json")) name += "." + ext;
        }
        web.evaluateJavascript("window.receiveSharedFile(" + JSONObject.quote(doc.route)
                + "," + JSONObject.quote(name) + ")", null);
    }

    private void showPage(String url) {
        pageReady = false;
        web.loadUrl(url);
    }

    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xff195c50);
        web = new WebView(this);
        setContentView(web);
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.addJavascriptInterface(new VocabularyBridge(this), "QuizAndroid");
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageFinished(WebView view, String url) {
                if (HOME.equals(url)) {
                    pageReady = true;
                    offerShared();
                }
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri uri = req.getUrl();
                String path = uri.getPath();
                SharedDoc doc = shared;
                if (doc != null && "quiz.invalid".equals(uri.getHost()) && doc.route.equals(path)) {
                    try {
                        InputStream stream = getContentResolver().openInputStream(doc.uri);
                        if (stream != null) return new WebResourceResponse("application/octet-stream", null, stream);
                    } catch (IOException | RuntimeException ignored) {}
                }
                if ("https".equals(uri.getScheme()) && "quiz.invalid".equals(uri.getHost())
                        && path != null && path.startsWith("/assets/") && !path.contains("..")) {
                    String name = path.substring(8);
                    String type = name.endsWith(".js") ? "application/javascript" : URLConnection.guessContentTypeFromName(name);
                    if (name.endsWith(".css")) type = "text/css";
                    try {
                        return new WebResourceResponse(type, "UTF-8", getAssets().open(name));
                    } catch (IOException ignored) {}
                }
                return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found", null, null);
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pending != null) pending.onReceiveValue(null);
                pending = callback;
                Intent select = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                select.addCategory(Intent.CATEGORY_OPENABLE);
                select.setType("*/*");
                try {
                    startActivityForResult(select, 1);
                } catch (android.content.ActivityNotFoundException err) {
                    pending.onReceiveValue(null);
                    pending = null;
                    Toast.makeText(QuizActivity.this, "请先启用系统文件管理器", Toast.LENGTH_LONG).show();
                }
                return true;
            }
        });
        if (state == null) handleIntent(getIntent());
        showPage(HOME);
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 1 && pending != null) {
            Uri uri = result == RESULT_OK && data != null ? data.getData() : null;
            pending.onReceiveValue(uri != null && "content".equals(uri.getScheme()) ? new Uri[]{uri} : null);
            pending = null;
        }
    }

    @Override public void onBackPressed() {
        if (VOCABULARY.equals(web.getUrl())) {
            showPage(HOME);
            return;
        }
        web.evaluateJavascript("typeof window.quizBack === 'function' && window.quizBack()", value -> {
            if (!"true".equals(value)) finish();
        });
    }

    void openVocabulary(boolean open) {
        runOnUiThread(() -> {
            if (open && HOME.equals(web.getUrl())) showPage(VOCABULARY);
            if (!open && VOCABULARY.equals(web.getUrl())) showPage(HOME);
        });
    }

    void deliverVocabularyAnswer(String id, String text, boolean error) {
        runOnUiThread(() -> {
            if (VOCABULARY.equals(web.getUrl()) && !isFinishing() && !isDestroyed()) {
                web.evaluateJavascript("window.receiveVocabularyAnswer(" + JSONObject.quote(id)
                        + "," + JSONObject.quote(text) + "," + error + ")", null);
            }
        });
    }
}

