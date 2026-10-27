#import <React/RCTBridgeModule.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#import <TargetConditionals.h>

@interface YiqikanDeviceAuth : NSObject <RCTBridgeModule>
@end
@implementation YiqikanDeviceAuth
RCT_EXPORT_MODULE(YiqikanDeviceAuth)
+ (BOOL)requiresMainQueueSetup { return NO; }

- (NSData *)tag:(NSString *)origin {
  NSData *input = [origin dataUsingEncoding:NSUTF8StringEncoding];
  unsigned char digest[CC_SHA256_DIGEST_LENGTH]; CC_SHA256(input.bytes, (CC_LONG)input.length, digest);
  return [NSData dataWithBytes:digest length:sizeof(digest)];
}
- (SecKeyRef)key:(NSString *)origin error:(CFErrorRef *)error CF_RETURNS_RETAINED {
  if (!origin.length || origin.length > 300) return NULL;
  NSData *tag = [self tag:[@"yiqikan.auth.v2:" stringByAppendingString:origin]];
  NSDictionary *query = @{(__bridge id)kSecClass: (__bridge id)kSecClassKey, (__bridge id)kSecAttrApplicationTag: tag,
    (__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeECSECPrimeRandom, (__bridge id)kSecReturnRef: @YES};
  SecKeyRef key = NULL;
  OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)query, (CFTypeRef *)&key);
  if (status == errSecSuccess) return key;
  if (status != errSecItemNotFound) return NULL; // Never replace a temporarily inaccessible credential.
  NSMutableDictionary *attrs = [@{(__bridge id)kSecAttrKeyType: (__bridge id)kSecAttrKeyTypeECSECPrimeRandom,
    (__bridge id)kSecAttrKeySizeInBits: @256,
    (__bridge id)kSecPrivateKeyAttrs: @{(__bridge id)kSecAttrIsPermanent: @YES, (__bridge id)kSecAttrApplicationTag: tag,
      (__bridge id)kSecAttrAccessible: (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly}} mutableCopy];
#if !TARGET_OS_SIMULATOR
  attrs[(__bridge id)kSecAttrTokenID] = (__bridge id)kSecAttrTokenIDSecureEnclave;
#endif
  return SecKeyCreateRandomKey((__bridge CFDictionaryRef)attrs, error);
}
- (NSString *)publicKey:(SecKeyRef)key {
  SecKeyRef pub = SecKeyCopyPublicKey(key);
  if (!pub) return nil;
  CFErrorRef error = NULL;
  CFDataRef bytes = SecKeyCopyExternalRepresentation(pub, &error);
  CFRelease(pub);
  if (error) CFRelease(error);
  if (!bytes) return nil;
  NSString *result = [(__bridge NSData *)bytes base64EncodedStringWithOptions:0]; CFRelease(bytes); return result;
}
RCT_REMAP_METHOD(publicKey, publicKeyForOrigin:(NSString *)origin resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  CFErrorRef error = NULL; SecKeyRef key = [self key:origin error:&error];
  if (!key) { reject(@"KEY_UNAVAILABLE", @"设备密钥暂不可用", (__bridge NSError *)error); if (error) CFRelease(error); return; }
  NSString *pub = [self publicKey:key]; CFRelease(key);
  if (!pub) reject(@"KEY_UNAVAILABLE", @"无法读取设备公钥", nil); else resolve(pub);
}
RCT_REMAP_METHOD(sign, signForOrigin:(NSString *)origin message:(NSString *)message resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
  CFErrorRef error = NULL; SecKeyRef key = [self key:origin error:&error];
  if (!key) { reject(@"KEY_UNAVAILABLE", @"设备密钥暂不可用", (__bridge NSError *)error); if (error) CFRelease(error); return; }
  NSData *bytes = [message dataUsingEncoding:NSUTF8StringEncoding];
  id payload = bytes.length <= 4096 ? [NSJSONSerialization JSONObjectWithData:bytes options:0 error:nil] : nil;
  if (![payload isKindOfClass:[NSArray class]] || [payload count] != 8 || ![payload[0] isEqual:@"yiqikan.auth.v2"] ||
      (![[payload objectAtIndex:1] isEqual:@"login"] && ![[payload objectAtIndex:1] isEqual:@"socket"]) || ![payload[4] isEqual:[self publicKey:key]]) {
    CFRelease(key); reject(@"INVALID_CHALLENGE", @"设备验证挑战无效", nil); return;
  }
  CFDataRef signature = SecKeyCreateSignature(key, kSecKeyAlgorithmECDSASignatureMessageX962SHA256, (__bridge CFDataRef)bytes, &error);
  CFRelease(key);
  if (!signature) { reject(@"SIGN_FAILED", @"设备签名失败", (__bridge NSError *)error); if (error) CFRelease(error); return; }
  resolve([(__bridge NSData *)signature base64EncodedStringWithOptions:0]); CFRelease(signature);
}
@end
