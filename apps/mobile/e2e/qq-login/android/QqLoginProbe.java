package com.yiqikan.app;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import com.tencent.tauth.IUiListener;
import com.tencent.tauth.Tencent;
import com.tencent.tauth.UiError;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.json.JSONObject;

public final class QqLoginProbe extends Activity {
    private static final String APP_ID = "1112545470";
    private static final String VERIFY_URL = "http://127.0.0.1:3321/api/client-auth/qq-probe";
    private Button login;
    private TextView status;
    private Tencent sdk;

    private final IUiListener listener = new IUiListener() {
        @Override public void onComplete(Object result) {
            if (!(result instanceof JSONObject)) {
                finishProbe("QQ 返回了无法读取的结果");
                return;
            }
            JSONObject identity = (JSONObject) result;
            String openId = identity.optString("openid");
            String token = identity.optString("access_token");
            if (token.isEmpty() || openId.isEmpty()) {
                finishProbe("QQ 回跳缺少令牌或 OpenID");
                return;
            }
            try {
                byte[] digest = MessageDigest.getInstance("SHA-256").digest(openId.getBytes(StandardCharsets.UTF_8));
                StringBuilder fingerprint = new StringBuilder();
                for (int index = 0; index < 8; index++) fingerprint.append(String.format("%02x", digest[index] & 0xff));
                runOnUiThread(() -> status.setText("QQ 已回跳，正在通过 USB 校验身份…"));
                new Thread(() -> verifyIdentity(token, fingerprint.toString()), "qq-probe-verifier").start();
            } catch (Exception error) {
                finishProbe("无法计算身份指纹");
            }
        }

        @Override public void onError(UiError error) { finishProbe("QQ 授权失败，错误码：" + error.errorCode); }
        @Override public void onCancel() { finishProbe("已取消 QQ 授权"); }
        @Override public void onWarning(int code) { runOnUiThread(() -> status.setText("QQ 提示码：" + code)); }
    };

    @Override protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        status = new TextView(this);
        status.setText("继续后将发起 QQ 授权，并通过 USB 向本机开发服务校验身份。");
        login = new Button(this);
        login.setText("继续并测试 QQ 登录");
        content.addView(login);
        content.addView(status);
        setContentView(content);
        login.setOnClickListener(view -> {
            login.setEnabled(false);
            status.setText("等待 QQ 授权…");
            Tencent.setIsPermissionGranted(true);
            sdk = Tencent.createInstance(APP_ID, getApplicationContext());
            if (sdk == null || sdk.login(this, "get_user_info", listener) == -1) {
                finishProbe("QQ SDK 未能启动授权");
            }
        });
    }

    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        Tencent.onActivityResultData(request, result, data, listener);
    }

    private void verifyIdentity(String token, String fingerprint) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(VERIFY_URL).openConnection();
            connection.setInstanceFollowRedirects(false);
            connection.setConnectTimeout(5_000);
            connection.setReadTimeout(10_000);
            connection.setRequestMethod("POST");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            int code = connection.getResponseCode();
            if (code != 200) {
                finishProbe("QQ 已回跳，后端校验失败 (HTTP " + code + ")");
                return;
            }
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                String remote = new JSONObject(reader.readLine()).optString("fingerprint");
                finishProbe(fingerprint.equals(remote) ? "QQ 已回跳，后端身份比对一致" : "QQ 已回跳，后端身份比对不一致");
            }
        } catch (Exception ignored) {
            finishProbe("QQ 已回跳，无法连接 USB 校验服务");
        } finally {
            if (connection != null) connection.disconnect();
        }
    }

    private void finishProbe(String message) {
        runOnUiThread(() -> {
            if (sdk != null) sdk.logout(getApplicationContext());
            status.setText(message);
            login.setEnabled(true);
        });
    }
}
