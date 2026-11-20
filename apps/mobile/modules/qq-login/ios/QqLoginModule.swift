import ExpoModulesCore
import UIKit

public final class QqLoginModule: Module {
  public func definition() -> ModuleDefinition {
    Name("YiqikanQqAuth")
    Constant("available") { QqLoginBridge.isAvailable() }

    AsyncFunction("authorize") { (promise: Promise) in
      QqLoginBridge.authorize { credential, error in
        if let error {
          promise.reject("QQ_AUTH_FAILED", error)
        } else {
          promise.resolve(credential)
        }
      }
    }.runOnQueue(.main)
  }
}

public final class QqLoginSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any]) -> Bool {
    QqLoginBridge.handle(url, universal: false)
  }

  public func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    guard userActivity.activityType == NSUserActivityTypeBrowsingWeb, let url = userActivity.webpageURL else {
      return false
    }
    return QqLoginBridge.handle(url, universal: true)
  }
}
