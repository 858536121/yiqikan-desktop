package expo.modules.yiqikanqq

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Handler
import android.os.Looper
import com.tencent.connect.common.Constants
import com.tencent.tauth.IUiListener
import com.tencent.tauth.Tencent
import com.tencent.tauth.UiError
import expo.modules.kotlin.Promise
import java.security.MessageDigest
import org.json.JSONObject

internal class QqAuth {
    val available = true
    private val main = Handler(Looper.getMainLooper())
    private var active: Authorization? = null

    fun authorize(activity: Activity, promise: Promise) {
        if (active != null) {
            promise.reject("QQ_BUSY", "已有 QQ 授权正在进行", null)
            return
        }
        try {
            Tencent.setIsPermissionGranted(true)
            val context = activity.applicationContext
            val sdk = Tencent.createInstance("1112545470", context)
            if (sdk == null) {
                promise.reject("QQ_UNAVAILABLE", "QQ SDK 初始化失败", null)
                return
            }
            val authorization = Authorization(sdk, context, promise)
            active = authorization
            main.postDelayed(authorization.timeout, 120_000)
            if (sdk.login(activity, "get_user_info", authorization) == -1) {
                authorization.finish(error = "QQ SDK 未能启动授权")
            }
        } catch (_: Exception) {
            val authorization = active
            if (authorization == null) promise.reject("QQ_UNAVAILABLE", "QQ 授权暂不可用", null)
            else authorization.finish(error = "QQ 授权暂不可用")
        }
    }

    fun onActivityResult(request: Int, result: Int, data: Intent?) {
        if (request == Constants.REQUEST_LOGIN) {
            val authorization = active ?: return
            Tencent.onActivityResultData(request, result, data, authorization)
        }
    }

    private inner class Authorization(
        private val sdk: Tencent,
        private val context: Context,
        private val promise: Promise
    ) : IUiListener {
        val timeout = Runnable { finish(error = "等待 QQ 授权超时") }

        override fun onComplete(result: Any?) {
            val identity = result as? JSONObject
            val token = identity?.optString("access_token").orEmpty()
            val openId = identity?.optString("openid").orEmpty()
            if (token.isEmpty() || openId.isEmpty()) {
                finish(error = "QQ 回跳缺少授权令牌或身份")
                return
            }
            finish(mapOf("accessToken" to token, "tokenHash" to digest(token), "deviceSlot" to digest(openId)))
        }

        override fun onError(error: UiError) = finish(error = "QQ 授权失败 (${error.errorCode})")
        override fun onCancel() = finish()
        override fun onWarning(code: Int) = Unit

        fun finish(credential: Map<String, String>? = null, error: String? = null) {
            main.post {
                if (active !== this) return@post
                active = null
                main.removeCallbacks(timeout)
                runCatching { sdk.logout(context) }
                if (error == null) promise.resolve(credential) else promise.reject("QQ_AUTH_FAILED", error, null)
            }
        }
    }

    private fun digest(value: String) = MessageDigest.getInstance("SHA-256")
        .digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
}
