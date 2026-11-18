Pod::Spec.new do |s|
  s.name = 'YiqikanQqLogin'
  s.version = '1.0.0'
  s.summary = 'QQ account authorization for Yiqikan'
  s.homepage = 'https://yiqikan.club'
  s.author = 'Yiqikan'
  s.license = 'Proprietary'
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = 'ios/*.{h,m,swift}'

  if ENV['YIQIKAN_QQ_LOGIN_NATIVE'] == '1' || ENV['YIQIKAN_QQ_PROBE_NATIVE'] == '1'
    unless File.directory?(File.join(__dir__, 'sdk', 'TencentOpenAPI.xcframework'))
      raise 'QQ login needs sdk/TencentOpenAPI.xcframework'
    end
    s.vendored_frameworks = 'sdk/TencentOpenAPI.xcframework'
    s.resource_bundles = { 'YiqikanQqPrivacy' => ['sdk/TencentOpenAPI.xcframework/ios-arm64/TencentOpenAPI.framework/PrivacyInfo.xcprivacy'] }
    s.frameworks = 'Security', 'CoreTelephony', 'SystemConfiguration', 'CoreGraphics', 'WebKit'
    s.libraries = 'sqlite3', 'z', 'c++'
    s.pod_target_xcconfig = { 'GCC_PREPROCESSOR_DEFINITIONS' => '$(inherited) YIQIKAN_QQ_SDK=1' }
    s.user_target_xcconfig = { 'OTHER_LDFLAGS' => '$(inherited) -ObjC' }
  end
end
