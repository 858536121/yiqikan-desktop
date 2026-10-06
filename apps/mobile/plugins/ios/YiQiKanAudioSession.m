#import <AVFoundation/AVFoundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>
#if defined(YIQIKAN_NATIVE_VOICE)
#import <WebRTC/RTCAudioSession.h>
#import <WebRTC/RTCAudioSessionConfiguration.h>
#endif

@interface YiQiKanAudioSession : RCTEventEmitter <RCTBridgeModule
#if defined(YIQIKAN_NATIVE_VOICE)
  , RTCAudioSessionDelegate
#endif
>
@end

@implementation YiQiKanAudioSession {
  BOOL _callActive;
  BOOL _interrupted;
  BOOL _hasListeners;
#if defined(YIQIKAN_NATIVE_VOICE)
  BOOL _nativeAudioRunning;
  BOOL _sessionActivationOwned;
  NSUInteger _audioRestartGeneration;
  NSError *_audioUnitStartError;
#endif
}

RCT_EXPORT_MODULE(YiQiKanAudioSession)

+ (BOOL)requiresMainQueueSetup { return YES; }
- (dispatch_queue_t)methodQueue { return dispatch_get_main_queue(); }
- (NSArray<NSString *> *)supportedEvents { return @[@"YiQiKanAudioSessionChanged"]; }
- (void)startObserving { _hasListeners = YES; }
- (void)stopObserving { _hasListeners = NO; }

- (instancetype)init {
  if ((self = [super init])) {
    NSNotificationCenter *center = NSNotificationCenter.defaultCenter;
    [center addObserver:self selector:@selector(interruptionChanged:)
                   name:AVAudioSessionInterruptionNotification object:nil];
    [center addObserver:self selector:@selector(routeChanged:)
                   name:AVAudioSessionRouteChangeNotification object:nil];
    [center addObserver:self selector:@selector(mediaServicesReset:)
                   name:AVAudioSessionMediaServicesWereResetNotification object:nil];
#if defined(YIQIKAN_NATIVE_VOICE)
    RTCAudioSession *rtc = RTCAudioSession.sharedInstance;
    rtc.useManualAudio = YES;
    rtc.isAudioEnabled = NO;
    [rtc addDelegate:self];
    RTCAudioSessionConfiguration *configuration = [RTCAudioSessionConfiguration webRTCConfiguration];
    configuration.category = AVAudioSessionCategoryPlayAndRecord;
    configuration.mode = AVAudioSessionModeVoiceChat;
    configuration.categoryOptions = AVAudioSessionCategoryOptionMixWithOthers |
      AVAudioSessionCategoryOptionDefaultToSpeaker | AVAudioSessionCategoryOptionAllowBluetooth;
    // WebRTC's own later activation must use the same mixable policy.
    [RTCAudioSessionConfiguration setWebRTCConfiguration:configuration];
#endif
  }
  return self;
}

- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
#if defined(YIQIKAN_NATIVE_VOICE)
  [RTCAudioSession.sharedInstance removeDelegate:self];
#endif
}

- (void)invalidate {
#if defined(YIQIKAN_NATIVE_VOICE)
  _callActive = NO;
  _audioRestartGeneration++;
  RTCAudioSession *rtc = RTCAudioSession.sharedInstance;
  rtc.isAudioEnabled = NO;
  [rtc lockForConfiguration];
  if (_sessionActivationOwned) {
    [rtc setActive:NO error:nil];
    _sessionActivationOwned = NO;
  }
  [rtc unlockForConfiguration];
#endif
  [super invalidate];
}

- (NSDictionary *)snapshot:(NSString *)reason {
  AVAudioSession *session = AVAudioSession.sharedInstance;
  NSMutableArray *outputs = [NSMutableArray array];
  for (AVAudioSessionPortDescription *output in session.currentRoute.outputs) {
    [outputs addObject:output.portType];
  }
  NSMutableDictionary *state = [@{@"reason": reason, @"category": session.category, @"mode": session.mode,
           @"options": @(session.categoryOptions), @"outputs": outputs,
           @"interrupted": @(_interrupted)} mutableCopy];
#if defined(YIQIKAN_NATIVE_VOICE)
  state[@"nativeVoice"] = @YES;
  state[@"nativeAudioRunning"] = @(_nativeAudioRunning);
  RTCAudioSession *rtc = RTCAudioSession.sharedInstance;
  state[@"audioEnabled"] = @(rtc.isAudioEnabled);
  state[@"sessionActive"] = @(rtc.isActive);
  state[@"inputAvailable"] = @(session.inputAvailable);
  state[@"inputChannels"] = @(session.inputNumberOfChannels);
  state[@"sampleRate"] = @(session.sampleRate);
  if (_audioUnitStartError) state[@"audioUnitStartError"] = @{
    @"domain": _audioUnitStartError.domain, @"code": @(_audioUnitStartError.code)};
#endif
  return state;
}

- (BOOL)configure:(NSError **)error {
  if (!_callActive || _interrupted) return YES;
  AVAudioSession *session = AVAudioSession.sharedInstance;
  AVAudioSessionCategoryOptions required = AVAudioSessionCategoryOptionMixWithOthers |
    AVAudioSessionCategoryOptionDefaultToSpeaker | AVAudioSessionCategoryOptionAllowBluetooth;
#if defined(YIQIKAN_NATIVE_VOICE)
  RTCAudioSession *rtc = RTCAudioSession.sharedInstance;
  [rtc lockForConfiguration];
  BOOL ok = YES;
  if (![session.category isEqualToString:AVAudioSessionCategoryPlayAndRecord] ||
      ![session.mode isEqualToString:AVAudioSessionModeVoiceChat] ||
      (session.categoryOptions & required) != required) {
    ok = [rtc setConfiguration:[RTCAudioSessionConfiguration webRTCConfiguration] error:error];
  }
  if (ok && !_sessionActivationOwned) {
    ok = [rtc setActive:YES error:error];
    if (ok) _sessionActivationOwned = YES;
  }
  for (AVAudioSessionPortDescription *output in session.currentRoute.outputs) {
    if (ok && [output.portType isEqualToString:AVAudioSessionPortBuiltInReceiver]) {
      ok = [rtc overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:error];
    }
  }
  [rtc unlockForConfiguration];
  if (ok) rtc.isAudioEnabled = YES;
  return ok;
#else
  // Preserve WebKit's voice-processing mode and avoid category-change feedback loops.
  if (![session.category isEqualToString:AVAudioSessionCategoryPlayAndRecord] ||
      (session.categoryOptions & required) != required) {
    AVAudioSessionMode mode = [session.category isEqualToString:AVAudioSessionCategoryPlayAndRecord]
      ? session.mode : AVAudioSessionModeDefault;
    if (![session setCategory:AVAudioSessionCategoryPlayAndRecord mode:mode
                     options:required error:error]) return NO;
  }
  // NotifyOthersOnDeactivation is for deactivation, never for setActive:YES.
  if (![session setActive:YES error:error]) return NO;
  for (AVAudioSessionPortDescription *output in session.currentRoute.outputs) {
    if ([output.portType isEqualToString:AVAudioSessionPortBuiltInReceiver]) {
      return [session overrideOutputAudioPort:AVAudioSessionPortOverrideSpeaker error:error];
    }
  }
  // Honor headphones, Bluetooth and user-selected external routes.
  return YES;
#endif
}

- (BOOL)configureForExplicitResume:(NSError **)error {
  if (!_callActive) return YES;
  BOOL wasInterrupted = _interrupted;
  // An interruption-began notification is not guaranteed to have an ended
  // notification. A foreground transition or a new call may retry activation;
  // an ongoing system interruption still makes setActive fail.
  if (_interrupted) {
#if defined(YIQIKAN_NATIVE_VOICE)
    RTCAudioSession *rtc = RTCAudioSession.sharedInstance;
    [rtc lockForConfiguration];
    BOOL ok = [rtc setActive:YES error:error];
    if (ok) {
      // Keep one app-owned reference; an explicit retry must not accumulate references.
      if (_sessionActivationOwned) [rtc setActive:NO error:nil];
      else _sessionActivationOwned = YES;
    }
    [rtc unlockForConfiguration];
    if (!ok) return NO;
#else
    if (![AVAudioSession.sharedInstance setActive:YES error:error]) return NO;
#endif
    _interrupted = NO;
  }
  if (![self configure:error]) {
    _interrupted = wasInterrupted;
    return NO;
  }
  return YES;
}

- (void)emitChange:(NSString *)reason {
  NSDictionary *state = [self snapshot:reason];
  NSLog(@"[YiQiKanAudioSession] %@", state);
  if (_hasListeners && _callActive) {
    [self sendEventWithName:@"YiQiKanAudioSessionChanged" body:state];
  }
}

- (void)interruptionChanged:(NSNotification *)notification {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_interrupted = [notification.userInfo[AVAudioSessionInterruptionTypeKey] unsignedIntegerValue]
      == AVAudioSessionInterruptionTypeBegan;
    [self emitChange:self->_interrupted ? @"interruption-began" : @"interruption-ended"];
  });
}

- (void)routeChanged:(NSNotification *)notification {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (!self->_callActive || self->_interrupted) return;
    NSError *error = nil;
    if (![self configure:&error]) NSLog(@"[YiQiKanAudioSession] Route recovery failed: %@", error);
    [self emitChange:@"route-change"];
  });
}

- (void)mediaServicesReset:(NSNotification *)notification {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_interrupted = NO;
    [self emitChange:@"media-services-reset"];
  });
}

#if defined(YIQIKAN_NATIVE_VOICE)
- (void)audioSessionDidStartPlayOrRecord:(RTCAudioSession *)session {
  dispatch_async(dispatch_get_main_queue(), ^{
    // This reports a start request, before AudioUnitInitialize/AudioOutputUnitStart.
    // Actual RTP/PCM progress must also be checked by the engine.
    self->_audioUnitStartError = nil;
    self->_nativeAudioRunning = self->_callActive;
    [self emitChange:@"native-audio-started"];
  });
}
- (void)audioSessionDidStopPlayOrRecord:(RTCAudioSession *)session {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_nativeAudioRunning = NO;
    [self emitChange:@"native-audio-stopped"];
  });
}
- (void)audioSession:(RTCAudioSession *)session audioUnitStartFailedWithError:(NSError *)error {
  dispatch_async(dispatch_get_main_queue(), ^{
    self->_audioUnitStartError = error;
    self->_nativeAudioRunning = NO;
    [self emitChange:@"native-audio-start-failed"];
  });
}

RCT_EXPORT_METHOD(restartAudio:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  if (!_callActive || _interrupted) { resolve([self snapshot:@"native-audio-restart-skipped"]); return; }
  NSUInteger generation = ++_audioRestartGeneration;
  // Keep the app-owned active-session reference and mixable policy while the
  // ADM stops/uninitializes the stalled unit. Its release cannot stop WebKit.
  RTCAudioSession.sharedInstance.isAudioEnabled = NO;
  _nativeAudioRunning = NO;
  [self emitChange:@"native-audio-restarting"];
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_main_queue(), ^{
    if (generation != self->_audioRestartGeneration || !self->_callActive || self->_interrupted) {
      resolve([self snapshot:@"native-audio-restart-cancelled"]); return;
    }
    NSError *error = nil;
    if (![self configure:&error]) { reject(@"audio_device_restart", error.localizedDescription, error); return; }
    resolve([self snapshot:@"native-audio-restart-requested"]);
  });
}
#endif

RCT_EXPORT_METHOD(getState:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  resolve([self snapshot:@"snapshot"]);
}

RCT_EXPORT_METHOD(activate:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  _callActive = YES;
  NSError *error = nil;
  if (![self configureForExplicitResume:&error]) {
    reject(@"audio_session_activate", error.localizedDescription, error);
    return;
  }
  resolve([self snapshot:@"activate"]);
}

RCT_EXPORT_METHOD(recover:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil;
  if (![self configure:&error]) {
    reject(@"audio_session_recover", error.localizedDescription, error);
    return;
  }
  resolve([self snapshot:@"recover"]);
}

RCT_EXPORT_METHOD(retryActivation:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  NSError *error = nil;
  if (![self configureForExplicitResume:&error]) {
    reject(@"audio_session_retry", error.localizedDescription, error);
    return;
  }
  resolve([self snapshot:@"retry-activation"]);
}

RCT_EXPORT_METHOD(deactivate:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  _callActive = NO;
#if defined(YIQIKAN_NATIVE_VOICE)
  _audioRestartGeneration++;
  RTCAudioSession *rtc = RTCAudioSession.sharedInstance;
  rtc.isAudioEnabled = NO;
  _nativeAudioRunning = NO;
  // Track/peer teardown releases capture. Keep the app-owned session reference
  // until bridge invalidation, so WebRTC's last release cannot deactivate the
  // shared AVAudioSession underneath a playing video WebView.
#else
  // WebKit releases the microphone when the JS call ends. Deactivating the
  // shared session here would also interrupt the still-playing video WebView.
#endif
  resolve(nil);
}
@end
