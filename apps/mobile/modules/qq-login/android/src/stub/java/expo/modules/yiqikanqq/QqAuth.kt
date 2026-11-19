package expo.modules.yiqikanqq

import android.app.Activity
import android.content.Intent
import expo.modules.kotlin.Promise

internal class QqAuth {
    val available = false

    fun authorize(activity: Activity, promise: Promise) {
        promise.reject("QQ_SDK_UNAVAILABLE", "此安装包未集成 QQ SDK", null)
    }

    fun onActivityResult(request: Int, result: Int, data: Intent?) = Unit
}
