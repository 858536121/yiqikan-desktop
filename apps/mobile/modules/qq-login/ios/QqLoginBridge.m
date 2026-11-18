#import "QqLoginBridge.h"

#if YIQIKAN_QQ_SDK
#import <CommonCrypto/CommonDigest.h>
#import <TencentOpenAPI/TencentOAuth.h>

@interface QqAuthorization : NSObject <TencentSessionDelegate>
@property(nonatomic, copy) void (^completion)(NSDictionary<NSString *, NSString *> *, NSString *);
- (void)finish:(NSDictionary<NSString *, NSString *> *)credential error:(NSString *)error;
@end

static QqAuthorization *active;
static NSString *qqDigest(NSString *value) {
    NSData *data = [value dataUsingEncoding:NSUTF8StringEncoding];
    unsigned char digest[CC_SHA256_DIGEST_LENGTH];
    CC_SHA256(data.bytes, (CC_LONG)data.length, digest);
    NSMutableString *hex = [NSMutableString stringWithCapacity:CC_SHA256_DIGEST_LENGTH * 2];
    for (NSUInteger i = 0; i < CC_SHA256_DIGEST_LENGTH; i++) [hex appendFormat:@"%02x", digest[i]];
    return hex;
}

@implementation QqAuthorization
- (void)finish:(NSDictionary<NSString *, NSString *> *)credential error:(NSString *)error {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (active != self) return;
        active = nil;
        [[TencentOAuth sharedInstance] logout:nil];
        self.completion(credential, error);
    });
}

- (void)tencentDidLogin {
    TencentOAuth *sdk = [TencentOAuth sharedInstance];
    NSString *token = sdk.accessToken, *openId = sdk.openId;
    if (!token.length || !openId.length) {
        [self finish:nil error:@"QQ 回跳缺少授权令牌或身份"];
        return;
    }
    [self finish:@{@"accessToken": token, @"tokenHash": qqDigest(token), @"deviceSlot": qqDigest(openId)} error:nil];
}

- (void)tencentDidNotLogin:(BOOL)cancelled {
    [self finish:nil error:cancelled ? nil : @"QQ 授权失败"];
}

- (void)tencentDidNotNetWork {
    [self finish:nil error:@"QQ 授权网络不可用"];
}
@end
#endif

@implementation QqLoginBridge
+ (BOOL)isAvailable {
#if YIQIKAN_QQ_SDK
    return YES;
#else
    return NO;
#endif
}

+ (void)authorize:(void (^)(NSDictionary<NSString *, NSString *> *, NSString *))completion {
#if YIQIKAN_QQ_SDK
    if (active) {
        completion(nil, @"已有 QQ 授权正在进行");
        return;
    }
    QqAuthorization *authorization = [QqAuthorization new];
    authorization.completion = completion;
    active = authorization;
    [TencentOAuth setIsUserAgreedAuthorization:YES];
    TencentOAuth *sdk = [TencentOAuth sharedInstance];
    [sdk setupAppId:@"1112545470"
  enableUniveralLink:YES
       universalLink:@"https://yiqikan.club/qq_conn/1112545470/"
            delegate:authorization];
    if (![sdk authorize:@[@"get_user_info"]]) {
        [authorization finish:nil error:@"QQ SDK 未能启动授权"];
        return;
    }
    __weak QqAuthorization *pending = authorization;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 120 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        [pending finish:nil error:@"等待 QQ 授权超时"];
    });
#else
    completion(nil, @"此安装包未集成 QQ SDK");
#endif
}

+ (BOOL)handle:(NSURL *)url universal:(BOOL)universal {
#if YIQIKAN_QQ_SDK
    if (!active) return NO;
    if (universal) return [TencentOAuth CanHandleUniversalLink:url] && [TencentOAuth HandleUniversalLink:url];
    return [TencentOAuth CanHandleOpenURL:url] && [TencentOAuth HandleOpenURL:url];
#else
    return NO;
#endif
}
@end
