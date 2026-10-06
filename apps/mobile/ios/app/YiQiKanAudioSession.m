#import <AVFoundation/AVFoundation.h>
#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface YiQiKanAudioSession : RCTEventEmitter <RCTBridgeModule>
@end

@implementation YiQiKanAudioSession {
  BOOL _callActive;
  BOOL _interrupted;
  BOOL _hasListeners;
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
  }
  return self;
}

- (void)dealloc {
  [NSNotificationCenter.defaultCenter removeObserver:self];
}

- (NSDictionary *)snapshot:(NSString *)reason {
  AVAudioSession *session = AVAudioSession.sharedInstance;
  NSMutableArray *outputs = [NSMutableArray array];
  for (AVAudioSessionPortDescription *output in session.currentRoute.outputs) {
    [outputs addObject:output.portType];
  }
  return @{@"reason": reason, @"category": session.category, @"mode": session.mode,
           @"options": @(session.categoryOptions), @"outputs": outputs,
           @"interrupted": @(_interrupted)};
}

- (BOOL)configure:(NSError **)error {
  if (!_callActive || _interrupted) return YES;
  AVAudioSession *session = AVAudioSession.sharedInstance;
  AVAudioSessionCategoryOptions required = AVAudioSessionCategoryOptionMixWithOthers |
    AVAudioSessionCategoryOptionDefaultToSpeaker | AVAudioSessionCategoryOptionAllowBluetooth;
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
}

- (BOOL)configureForExplicitResume:(NSError **)error {
  if (!_callActive) return YES;
  BOOL wasInterrupted = _interrupted;
  // An interruption-began notification is not guaranteed to have an ended
  // notification. A foreground transition or a new call may retry activation;
  // an ongoing system interruption still makes setActive fail.
  if (_interrupted) {
    if (![AVAudioSession.sharedInstance setActive:YES error:error]) return NO;
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
  // WebKit releases the microphone when the JS call ends. Deactivating the
  // shared session here would also interrupt the still-playing video WebView.
  resolve(nil);
}
@end
