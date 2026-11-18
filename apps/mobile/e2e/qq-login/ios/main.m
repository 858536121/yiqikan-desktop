#import <CommonCrypto/CommonDigest.h>
#import <TencentOpenAPI/TencentOAuth.h>
#import <UIKit/UIKit.h>

@interface QqLoginProbe : UIResponder <UIApplicationDelegate, TencentSessionDelegate>
@property(nonatomic, strong) UIWindow *window;
@property(nonatomic, strong) UIButton *loginButton;
@property(nonatomic, strong) UILabel *status;
@end

@implementation QqLoginProbe
- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)options {
    UIViewController *screen = [UIViewController new];
    screen.view.backgroundColor = UIColor.systemBackgroundColor;
    self.loginButton = [UIButton buttonWithType:UIButtonTypeSystem];
    [self.loginButton setTitle:@"继续并测试 QQ 登录" forState:UIControlStateNormal];
    [self.loginButton addTarget:self action:@selector(authorize) forControlEvents:UIControlEventTouchUpInside];
    self.status = [UILabel new];
    self.status.text = @"选择继续即允许 QQ SDK 在本次测试中获取设备信息并进行授权。";
    self.status.numberOfLines = 0;
    self.status.textAlignment = NSTextAlignmentCenter;
    UIStackView *stack = [[UIStackView alloc] initWithArrangedSubviews:@[self.loginButton, self.status]];
    stack.axis = UILayoutConstraintAxisVertical;
    stack.spacing = 12;
    stack.translatesAutoresizingMaskIntoConstraints = NO;
    [screen.view addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[
        [stack.centerYAnchor constraintEqualToAnchor:screen.view.centerYAnchor],
        [stack.leadingAnchor constraintEqualToAnchor:screen.view.safeAreaLayoutGuide.leadingAnchor constant:24],
        [stack.trailingAnchor constraintEqualToAnchor:screen.view.safeAreaLayoutGuide.trailingAnchor constant:-24],
    ]];
    self.window = [[UIWindow alloc] initWithFrame:UIScreen.mainScreen.bounds];
    self.window.rootViewController = screen;
    [self.window makeKeyAndVisible];
    return YES;
}

- (void)authorize {
    self.loginButton.enabled = NO;
    self.status.text = @"等待 QQ 授权…";
    [TencentOAuth setIsUserAgreedAuthorization:YES];
    TencentOAuth *sdk = [TencentOAuth sharedInstance];
    [sdk setupAppId:@"1112545470"
  enableUniveralLink:YES
       universalLink:@"https://yiqikan.club/qq_conn/1112545470/"
            delegate:self];
    if (![sdk authorize:@[@"get_user_info"]]) [self finishProbe:@"QQ SDK 未能启动授权"];
}

- (BOOL)application:(UIApplication *)application openURL:(NSURL *)url options:(NSDictionary *)options {
    return [TencentOAuth CanHandleOpenURL:url] && [TencentOAuth HandleOpenURL:url];
}

- (BOOL)application:(UIApplication *)application continueUserActivity:(NSUserActivity *)activity restorationHandler:(void (^)(NSArray<id<UIUserActivityRestoring>> * _Nullable))restore {
    NSURL *url = activity.webpageURL;
    return url && [TencentOAuth CanHandleUniversalLink:url] && [TencentOAuth HandleUniversalLink:url];
}

- (void)tencentDidLogin {
    TencentOAuth *sdk = [TencentOAuth sharedInstance];
    NSData *openId = [sdk.openId dataUsingEncoding:NSUTF8StringEncoding];
    if (!sdk.accessToken.length || !openId.length) {
        [self finishProbe:@"QQ 回跳缺少令牌或 OpenID"];
        return;
    }
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(openId.bytes, (CC_LONG)openId.length, digest);
    NSMutableString *fingerprint = [NSMutableString string];
    for (NSUInteger index = 0; index < 8; index++) [fingerprint appendFormat:@"%02x", digest[index]];
    [self finishProbe:[@"QQ 已回跳，身份指纹：" stringByAppendingString:fingerprint]];
}

- (void)tencentDidNotLogin:(BOOL)cancelled {
    [self finishProbe:cancelled ? @"已取消 QQ 授权" : @"QQ 授权失败"];
}

- (void)tencentDidNotNetWork { [self finishProbe:@"QQ 授权网络不可用"]; }

- (void)finishProbe:(NSString *)message {
    dispatch_async(dispatch_get_main_queue(), ^{
        [[TencentOAuth sharedInstance] logout:nil];
        self.status.text = message;
        self.loginButton.enabled = YES;
    });
}
@end

int main(int argc, char *argv[]) {
    @autoreleasepool {
        return UIApplicationMain(argc, argv, nil, NSStringFromClass(QqLoginProbe.class));
    }
}
