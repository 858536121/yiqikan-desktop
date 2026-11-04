// Simulator-only AVPlayer probe; no microphone, camera, credentials or room connection.
import UIKit
import AVFoundation
import WebKit

final class ProbeController: UIViewController {
  let endpoint = "http://127.0.0.1:4399"
  var player: AVPlayer?
  var layer: AVPlayerLayer?
  var output: AVPlayerItemVideoOutput?
  var timer: Timer?
  var busy = false
  var frames = 0
  var currentCommand = ""
  var web: WKWebView?
  var trackCount: Int? = nil
  let label = UILabel()
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    label.textColor = .white; label.numberOfLines = 3; label.text = "Independent playback probe"
    label.frame = CGRect(x: 15,y: 65,width: 360,height: 70); view.addSubview(label)
    timer = Timer.scheduledTimer(withTimeInterval: 0.5,repeats:true) { [weak self] _ in self?.tick() }
    post(["kind":"native-ready"])
  }
  func post(_ packet: [String:Any]) {
    var data = packet; data["native"] = true; data["at"] = Int(Date().timeIntervalSince1970*1000)
    var request = URLRequest(url:URL(string:endpoint+"/sample")!); request.httpMethod = "POST"
    request.setValue("application/json",forHTTPHeaderField:"Content-Type"); request.httpBody = try? JSONSerialization.data(withJSONObject:data)
    URLSession.shared.dataTask(with:request).resume()
  }
  func tick() {
    if let p=player,let item=p.currentItem {
      let t=p.currentTime()
      if let o=output,o.hasNewPixelBuffer(forItemTime:t),o.copyPixelBuffer(forItemTime:t,itemTimeForDisplay:nil) != nil { frames += 1 }
      var s:[String:Any] = ["kind":"native-sample","commandId":currentCommand,"time":t.seconds.isFinite ? t.seconds : 0,"rate":p.rate,"status":item.status.rawValue,"timeControl":p.timeControlStatus.rawValue,"frames":frames,"firstFrame":layer?.isReadyForDisplay ?? false,"bufferEmpty":item.isPlaybackBufferEmpty,"bufferLikely":item.isPlaybackLikelyToKeepUp]
      if let n=trackCount {s["audioTracks"]=n}
      if let e=item.error {s["error"]="\((e as NSError).domain):\((e as NSError).code) \(e.localizedDescription)"}
      if let e=item.errorLog()?.events.last {s["errorStatus"]=e.errorStatusCode;s["errorDomain"]=e.errorDomain}
      post(s)
    }
    guard !busy else{return};busy=true
    URLSession.shared.dataTask(with:URL(string:endpoint+"/command?client=native")!) { [weak self] data,_,_ in
      DispatchQueue.main.async {
        guard let self=self else{return}; self.busy=false
        if let data=data,let cmd=(try? JSONSerialization.jsonObject(with:data)) as? [String:Any],cmd["id"] != nil {self.run(cmd)}
      }
    }.resume()
  }
  func run(_ c:[String:Any]) {
    let id=c["id"] as? String ?? "";currentCommand=id
    let op=c["op"] as? String ?? ""
    if op=="native-load",let address=c["url"] as? String,let url=URL(string:address) {
      player?.pause();layer?.removeFromSuperlayer();web?.removeFromSuperview();frames=0;trackCount=nil
      // Diagnostic comparison: request context matching the original webpage.
      let headers=c["headers"] as? [String:String] ?? [:]
      let asset=AVURLAsset(url:url,options:headers.isEmpty ? nil : ["AVURLAssetHTTPHeaderFieldsKey":headers])
      let item=AVPlayerItem(asset:asset);let out=AVPlayerItemVideoOutput(pixelBufferAttributes:nil);item.add(out);output=out
      let p=AVPlayer(playerItem:item);player=p;let l=AVPlayerLayer(player:p);l.frame=CGRect(x:10,y:145,width:view.bounds.width-20,height:300);l.videoGravity = .resizeAspect;view.layer.addSublayer(l);layer=l
      label.text="Independent AVPlayer\n"+url.host!
      if !(c["paused"] as? Bool ?? false) { p.play() }
      Task { let tracks=try? await asset.loadTracks(withMediaType:.audio);await MainActor.run {if self.currentCommand==id {self.trackCount=tracks?.count}} }
    } else if op=="native-pause" {player?.pause()}
    else if op=="native-play" {player?.play()}
    else if op=="native-seek",let time=c["time"] as? Double {player?.seek(to:CMTime(seconds:time,preferredTimescale:600),toleranceBefore:.zero,toleranceAfter:.zero)}
    else if op=="native-rate",let rate=c["rate"] as? Double {player?.rate=Float(rate)}
    else if op=="web-load",let address=c["url"] as? String {
      player?.pause();layer?.removeFromSuperlayer();web?.removeFromSuperview()
      let config=WKWebViewConfiguration();config.allowsInlineMediaPlayback=true;config.mediaTypesRequiringUserActionForPlayback=[]
      let w=WKWebView(frame:CGRect(x:0,y:145,width:view.bounds.width,height:400),configuration:config);web=w;view.addSubview(w)
      let encoded=address.replacingOccurrences(of:"&",with:"&amp;").replacingOccurrences(of:"\"",with:"&quot;")
      w.loadHTMLString("<html><body style='background:black;color:white'><video playsinline controls autoplay src=\"\(encoded)\" style='width:100%'></video></body></html>",baseURL:URL(string:"https://yiqikan.club"))
    } else if op=="web-inspect",let w=web {
      w.evaluateJavaScript("(()=>{let v=document.querySelector('video');return {time:v.currentTime,paused:v.paused,ready:v.readyState,error:v.error?.code,duration:Number.isFinite(v.duration)?v.duration:null,frames:v.getVideoPlaybackQuality?.().totalVideoFrames}})()") { result,error in self.post(["kind":"response","commandId":id,"result":result ?? NSNull(),"error":error?.localizedDescription ?? ""]) };return
    }
    post(["kind":"response","commandId":id,"op":op,"result":["accepted":true]])
  }
}
final class AppDelegate: UIResponder,UIApplicationDelegate {
  var window:UIWindow?
  func application(_ app:UIApplication,didFinishLaunchingWithOptions options:[UIApplication.LaunchOptionsKey:Any]?=nil)->Bool {
    let w=UIWindow(frame:UIScreen.main.bounds);w.rootViewController=ProbeController();w.makeKeyAndVisible();window=w;return true
  }
}
UIApplicationMain(CommandLine.argc,CommandLine.unsafeArgv,nil,NSStringFromClass(AppDelegate.self))
