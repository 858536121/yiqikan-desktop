// Simulator-only media feasibility probe, not a replacement for full-App E2E.
// No microphone capture, credentials, production rooms, or background-task extension.
import UIKit
import WebKit
import AVFoundation

final class BackgroundProbe: UIViewController, WKScriptMessageHandler {
  let endpoint = ProcessInfo.processInfo.environment["BACKGROUND_E2E_ENDPOINT"] ?? "http://127.0.0.1:18224"
  var web: WKWebView!
  var timer: Timer?
  var busy = false
  var observations: [NSObjectProtocol] = []
  var player: AVPlayer?
  var playerLayer: AVPlayerLayer?
  var playerObservation: Any?

  override func viewDidLoad() {
    super.viewDidLoad()
    let config = WKWebViewConfiguration()
    config.allowsInlineMediaPlayback = true
    config.allowsPictureInPictureMediaPlayback = true
    config.mediaTypesRequiringUserActionForPlayback = []
    config.userContentController.add(self, name: "probe")
    let script = """
    (()=>{
      const send=p=>window.webkit.messageHandlers.probe.postMessage(p);
      window.ReactNativeWebView={postMessage:message=>send({kind:'bridge',message})};
      document.addEventListener('visibilitychange',()=>send({kind:'visibility',hidden:document.hidden,at:Date.now()}));
      for(const event of ['play','playing','pause','waiting','stalled','ended','error']){
        document.addEventListener(event,e=>{const v=e.target;if(v instanceof HTMLMediaElement)send({kind:'media-event',event,time:v.currentTime,paused:v.paused,muted:v.muted,at:Date.now()})},true);
      }
    })();
    """
    config.userContentController.addUserScript(WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: false))
    web = WKWebView(frame: view.bounds, configuration: config)
    web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(web)
    for name in [UIApplication.willResignActiveNotification, UIApplication.didEnterBackgroundNotification,
                 UIApplication.willEnterForegroundNotification, UIApplication.didBecomeActiveNotification] {
      observations.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
        if name == UIApplication.didEnterBackgroundNotification { self?.playerLayer?.player = nil }
        if name == UIApplication.didBecomeActiveNotification { self?.playerLayer?.player = self?.player }
        self?.post(["kind": "lifecycle", "event": name.rawValue])
      })
    }
    timer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in self?.tick() }
    post(["kind": "ready"])
  }

  func post(_ packet: [String: Any]) {
    let audio = AVAudioSession.sharedInstance()
    var data = packet
    data["at"] = Int(Date().timeIntervalSince1970 * 1000)
    data["appState"] = UIApplication.shared.applicationState.rawValue
    data["audioCategory"] = audio.category.rawValue
    data["audioMode"] = audio.mode.rawValue
    var request = URLRequest(url: URL(string: endpoint + "/sample")!)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    if JSONSerialization.isValidJSONObject(data) {
      request.httpBody = try? JSONSerialization.data(withJSONObject: data)
    } else {
      request.httpBody = try? JSONSerialization.data(withJSONObject: ["kind": "response", "id": packet["id"] ?? "", "error": "Probe result cannot be represented as JSON"])
    }
    URLSession.shared.dataTask(with: request).resume()
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    if let packet = message.body as? [String: Any] { post(packet) }
  }

  func tick() {
    guard !busy else { return }
    busy = true
    URLSession.shared.dataTask(with: URL(string: endpoint + "/command")!) { [weak self] data, _, _ in
      DispatchQueue.main.async {
        guard let self = self else { return }
        self.busy = false
        if let data = data, let command = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], command["id"] != nil {
          self.run(command)
        }
      }
    }.resume()
  }

  func run(_ command: [String: Any]) {
    let id = command["id"] as? String ?? ""
    let op = command["op"] as? String ?? ""
    do {
      if op == "policy" {
        let policy = command["value"] as? String ?? "none"
        let audio = AVAudioSession.sharedInstance()
        if policy == "playback" {
          try audio.setCategory(.playback, mode: .moviePlayback)
          try audio.setActive(true)
        } else if policy == "voice-mix-policy-only" {
          // Models the category only; this does not establish or prove a voice call.
          try audio.setCategory(.playAndRecord, mode: .voiceChat, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetooth])
          try audio.setActive(true)
        } else if policy != "none" {
          throw NSError(domain: "BackgroundProbe", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unknown policy"])
        }
      } else if op == "load", let address = command["url"] as? String, let url = URL(string: address) {
        if let observation = playerObservation { player?.removeTimeObserver(observation) }
        playerObservation = nil
        player?.pause()
        player = nil
        playerLayer?.removeFromSuperlayer()
        playerLayer = nil
        web.isHidden = false
        web.load(URLRequest(url: url))
      } else if op == "native-load", let address = command["url"] as? String, let url = URL(string: address) {
        if let observation = playerObservation { player?.removeTimeObserver(observation) }
        player?.pause()
        playerLayer?.removeFromSuperlayer()
        web.loadHTMLString("", baseURL: nil)
        web.isHidden = true
        let player = AVPlayer(url: url)
        player.audiovisualBackgroundPlaybackPolicy = .continuesIfPossible
        self.player = player
        let layer = AVPlayerLayer(player: player)
        layer.frame = view.bounds
        layer.videoGravity = .resizeAspect
        view.layer.addSublayer(layer)
        playerLayer = layer
        playerObservation = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] time in
          self?.post(["kind": "native-progress", "time": time.seconds.isFinite ? time.seconds : 0, "rate": player.rate])
        }
        player.play()
      } else if op == "native-sample", let player = player {
        let time = player.currentTime().seconds
        post(["kind": "response", "id": id, "result": ["time": time.isFinite ? time : 0,
          "sampledAt": Int(Date().timeIntervalSince1970 * 1000),
          "paused": player.rate == 0, "ready": player.currentItem?.status == .readyToPlay ? 4 : 0,
          "muted": player.isMuted, "volume": player.volume, "timeControlStatus": player.timeControlStatus.rawValue]])
        return
      } else if op == "install-scripts", let before = command["before"] as? String, let after = command["after"] as? String {
        web.configuration.userContentController.addUserScript(WKUserScript(source: before, injectionTime: .atDocumentStart, forMainFrameOnly: false))
        web.configuration.userContentController.addUserScript(WKUserScript(source: after, injectionTime: .atDocumentEnd, forMainFrameOnly: false))
      } else if op == "eval", let script = command["script"] as? String {
        web.evaluateJavaScript(script) { result, error in
          self.post(["kind": "response", "id": id, "result": result ?? NSNull(), "error": error?.localizedDescription ?? ""])
        }
        return
      } else {
        throw NSError(domain: "BackgroundProbe", code: 2, userInfo: [NSLocalizedDescriptionKey: "Unknown command"])
      }
      post(["kind": "response", "id": id, "result": ["accepted": true]])
    } catch { post(["kind": "response", "id": id, "error": error.localizedDescription]) }
  }
}

final class BackgroundProbeDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?
  func application(_ application: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
    let window = UIWindow(frame: UIScreen.main.bounds)
    window.rootViewController = BackgroundProbe()
    window.makeKeyAndVisible()
    self.window = window
    return true
  }
}

UIApplicationMain(CommandLine.argc, CommandLine.unsafeArgv, nil, NSStringFromClass(BackgroundProbeDelegate.self))
