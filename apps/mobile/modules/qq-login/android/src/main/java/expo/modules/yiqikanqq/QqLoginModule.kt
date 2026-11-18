package expo.modules.yiqikanqq

import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class QqLoginModule : Module() {
    private val auth = QqAuth()

    override fun definition() = ModuleDefinition {
        Name("YiqikanQqAuth")
        Constant("available") { auth.available }

        AsyncFunction("authorize") { promise: Promise ->
            val activity = appContext.currentActivity
            if (activity == null) {
                promise.reject("QQ_ACTIVITY_UNAVAILABLE", "未找到当前页面", null)
            } else {
                auth.authorize(activity, promise)
            }
        }.runOnQueue(Queues.MAIN)

        OnActivityResult { _, result ->
            auth.onActivityResult(result.requestCode, result.resultCode, result.data)
        }
    }
}
