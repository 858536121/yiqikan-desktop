#import <UIKit/UIKit.h>
#import <MediaPlayer/MediaPlayer.h>
#import <AVFoundation/AVFoundation.h>
#import <React/RCTBridgeModule.h>
#import <TargetConditionals.h>

// Screen ownership is native so an interruption restores brightness even when
// the JS thread is suspended. This module never activates/configures audio.
@interface YiqikanPlayerDevice : NSObject <RCTBridgeModule>
@end

@implementation YiqikanPlayerDevice {
  NSNumber *_session;
  CGFloat _restoreBrightness;
  CGFloat _writtenBrightness;
  BOOL _hasWrittenBrightness;
  MPVolumeView *_volumeView;
  UISlider *_volumeSlider;
}
RCT_EXPORT_MODULE(YiqikanPlayerDevice)
+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }

- (instancetype)init {
  if ((self = [super init])) {
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:self selector:@selector(interrupted:) name:UIApplicationWillResignActiveNotification object:nil];
    [center addObserver:self selector:@selector(brightnessChanged:) name:UIScreenBrightnessDidChangeNotification object:nil];
  }
  return self;
}
- (void)dealloc { [NSNotificationCenter.defaultCenter removeObserver:self]; }
- (void)invalidate { dispatch_async(dispatch_get_main_queue(), ^{ [self finish]; }); }
- (void)interrupted:(NSNotification *)notification { [self finish]; }
- (void)brightnessChanged:(NSNotification *)notification {
  if (!_session) return;
  CGFloat value = UIScreen.mainScreen.brightness;
  // A control-center/device adjustment becomes the new restoration baseline.
  if (!_hasWrittenBrightness || fabs(value - _writtenBrightness) > .015) {
    _restoreBrightness = value;
    _hasWrittenBrightness = NO;
  }
}
- (UIWindow *)activeWindow {
  for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
    if (scene.activationState != UISceneActivationStateForegroundActive || ![scene isKindOfClass:UIWindowScene.class]) continue;
    for (UIWindow *window in ((UIWindowScene *)scene).windows) if (window.isKeyWindow) return window;
  }
  return nil;
}
- (void)prepareVolumeView {
#if !TARGET_OS_SIMULATOR
  UIWindow *window = [self activeWindow];
  if (!window) return;
  if (!_volumeView) {
    // Use the system volume control's public UISlider; never private volume
    // selectors or AudioSession setters. Keep it attached to the active window.
    _volumeView = [[MPVolumeView alloc] initWithFrame:CGRectMake(-200, -200, 120, 30)];
    _volumeView.userInteractionEnabled = NO;
    _volumeView.accessibilityElementsHidden = YES;
  }
  if (_volumeView.superview != window) [window addSubview:_volumeView];
  [_volumeView layoutIfNeeded];
  _volumeSlider = nil;
  for (UIView *child in _volumeView.subviews) if ([child isKindOfClass:UISlider.class]) { _volumeSlider = (UISlider *)child; break; }
#endif
}
- (NSDictionary *)snapshot {
  AVAudioSession *audio = AVAudioSession.sharedInstance;
  NSMutableArray *ports = [NSMutableArray array];
  for (AVAudioSessionPortDescription *port in audio.currentRoute.outputs) [ports addObject:port.UID ?: port.portType];
  return @{ @"brightness": @(UIScreen.mainScreen.brightness), @"volume": @(audio.outputVolume),
            @"canBrightness": @(_session != nil),
            @"canVolume": @(_session != nil && _volumeSlider != nil && _volumeSlider.enabled),
            @"route": [ports componentsJoinedByString:@"|"] ?: @"", @"active": @(_session != nil) };
}
- (void)finish {
  if (_session && _hasWrittenBrightness && fabs(UIScreen.mainScreen.brightness - _writtenBrightness) <= .015)
    UIScreen.mainScreen.brightness = _restoreBrightness;
  _session = nil;
  _hasWrittenBrightness = NO;
  [_volumeView removeFromSuperview];
  _volumeView = nil; _volumeSlider = nil;
}
RCT_REMAP_METHOD(begin, begin:(nonnull NSNumber *)token resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self finish];
  if (UIApplication.sharedApplication.applicationState != UIApplicationStateActive) { reject(@"INACTIVE", @"播放器未在前台", nil); return; }
  _session = token;
  _restoreBrightness = UIScreen.mainScreen.brightness;
  [self prepareVolumeView];
  resolve([self snapshot]);
}
RCT_REMAP_METHOD(read, read:(nonnull NSNumber *)token resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![_session isEqual:token]) { reject(@"EXPIRED", @"播放器控制已结束", nil); return; }
  [self prepareVolumeView];
  resolve([self snapshot]);
}
RCT_REMAP_METHOD(setBrightness, setBrightness:(nonnull NSNumber *)token value:(double)value resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (![_session isEqual:token] || !isfinite(value)) { reject(@"EXPIRED", @"播放器控制已结束", nil); return; }
  _writtenBrightness = MAX(.05, MIN(1, value));
  _hasWrittenBrightness = YES;
  UIScreen.mainScreen.brightness = _writtenBrightness;
  resolve([self snapshot]);
}
RCT_REMAP_METHOD(setVolume, setVolume:(nonnull NSNumber *)token value:(double)value route:(NSString *)route resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  [self prepareVolumeView];
  if (![_session isEqual:token] || !isfinite(value) || !_volumeSlider || !_volumeSlider.enabled || ![route isEqual:[self snapshot][@"route"]]) {
    reject(@"UNAVAILABLE", @"请使用设备音量键调节", nil); return;
  }
  [_volumeSlider setValue:MAX(0, MIN(1, value)) animated:NO];
  [_volumeSlider sendActionsForControlEvents:UIControlEventValueChanged];
  [_volumeSlider sendActionsForControlEvents:UIControlEventTouchUpInside];
  // AVAudioSession reports the actual output after the system slider settles.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 80 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    if (![self->_session isEqual:token]) { reject(@"EXPIRED", @"播放器控制已结束", nil); return; }
    resolve([self snapshot]);
  });
}
RCT_EXPORT_METHOD(end:(nonnull NSNumber *)token) { if ([_session isEqual:token]) [self finish]; }
@end
