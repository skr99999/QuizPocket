package net.quizpocket.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicBoolean;
import javax.net.ssl.HttpsURLConnection;
import org.json.JSONArray;
import org.json.JSONObject;

final class VocabularyBridge {
    private static final String WORD_LIST_ROOT = "https://github.com/KyleBing/english-vocabulary/blob/master/";
    private static final String[] WORD_LISTS = {"3 四级-乱序.txt", "4 六级-乱序.txt", "5 考研-乱序.txt"};
    private final QuizActivity activity;
    private final AtomicBoolean busy = new AtomicBoolean();

    VocabularyBridge(QuizActivity activity) { this.activity = activity; }

    @JavascriptInterface public void openVocabulary(boolean open) {
        activity.openVocabulary(open);
    }

    @JavascriptInterface public void openWordList(int index) {
        if (index < 0 || index >= WORD_LISTS.length) return;
        activity.runOnUiThread(() -> {
            try {
                activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(WORD_LIST_ROOT + Uri.encode(WORD_LISTS[index]))));
            } catch (ActivityNotFoundException error) {
                Toast.makeText(activity, "请先启用系统浏览器", Toast.LENGTH_LONG).show();
            }
        });
    }

    @JavascriptInterface public void askDeepSeek(String id, String key, String word, String question, String model, String reasoning) {
        if (id == null || id.length() > 50) return;
        if (key == null || !key.matches("[A-Za-z0-9_-]{1,200}") || word == null
                || word.length() > 200 || question == null || question.length() > 1000
                || !("deepseek-flash".equals(model) || "deepseek-v4-pro".equals(model))
                || !("off".equals(reasoning) || "low".equals(reasoning) || "high".equals(reasoning) || "max".equals(reasoning))) {
            activity.deliverVocabularyAnswer(id, "请检查 API Key 和问题格式。", true);
            return;
        }
        if (!busy.compareAndSet(false, true)) {
            activity.deliverVocabularyAnswer(id, "已有请求正在处理，请稍后重试。", true);
            return;
        }
        new Thread(() -> {
            HttpsURLConnection connection = null;
            try {
                JSONArray messages = new JSONArray()
                        .put(new JSONObject().put("role", "system").put("content",
                                "你是英语词汇老师。用简体中文解释英文用法，给出简短的英语例句和中文翻译。"))
                        .put(new JSONObject().put("role", "user").put("content",
                                "当前词条：" + word + "\n" + question));
                JSONObject payload = new JSONObject().put("model", model)
                        .put("thinking", new JSONObject().put("type", "off".equals(reasoning) ? "disabled" : "enabled"))
                        .put("max_tokens", "off".equals(reasoning) ? 900 : 4096).put("stream", false).put("messages", messages);
                if (!"off".equals(reasoning)) payload.put("reasoning_effort", reasoning);
                byte[] body = payload.toString().getBytes(StandardCharsets.UTF_8);
                connection = (HttpsURLConnection) new URL("https://api.deepseek.com/chat/completions").openConnection();
                connection.setRequestMethod("POST");
                connection.setInstanceFollowRedirects(false);
                connection.setConnectTimeout(12000);
                connection.setReadTimeout("off".equals(reasoning) ? 35000 : 180000);
                connection.setDoOutput(true);
                connection.setRequestProperty("Authorization", "Bearer " + key);
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream output = connection.getOutputStream()) {
                    output.write(body);
                }
                int status = connection.getResponseCode();
                if (status != 200) {
                    String message = status == 401 ? "API Key 无效，请检查后重试。"
                            : status == 402 ? "DeepSeek 账户余额不足。"
                            : status == 429 ? "DeepSeek 请求过于频繁，请稍后重试。"
                            : "DeepSeek 请求失败（HTTP " + status + "）。";
                    activity.deliverVocabularyAnswer(id, message, true);
                    return;
                }
                StringBuilder json = new StringBuilder();
                try (BufferedReader input = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    char[] buffer = new char[2048];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        if (json.length() + count > 65536) throw new IllegalStateException();
                        json.append(buffer, 0, count);
                    }
                }
                String answer = new JSONObject(json.toString()).getJSONArray("choices")
                        .getJSONObject(0).getJSONObject("message").optString("content", "").trim();
                activity.deliverVocabularyAnswer(id, answer.isEmpty() ? "DeepSeek 未返回解析，请重试。" : answer, answer.isEmpty());
            } catch (Exception error) {
                activity.deliverVocabularyAnswer(id, "无法取得 DeepSeek 的回复，请检查网络后重试。", true);
            } finally {
                if (connection != null) connection.disconnect();
                busy.set(false);
            }
        }, "quizpocket-deepseek").start();
    }
}
