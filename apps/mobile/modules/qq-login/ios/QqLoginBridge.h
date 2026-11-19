#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface QqLoginBridge : NSObject
+ (BOOL)isAvailable;
+ (void)authorize:(void (^)(NSDictionary<NSString *, NSString *> * _Nullable credential, NSString * _Nullable error))completion;
+ (BOOL)handle:(NSURL *)url universal:(BOOL)universal NS_SWIFT_NAME(handle(_:universal:));
@end

NS_ASSUME_NONNULL_END
