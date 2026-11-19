#!/usr/bin/env bash
set -euo pipefail

probe_dir=$(cd -- "$(dirname -- "$0")" && pwd)

case "${1:-}" in
  android)
    if [[ $# != 6 && $# != 7 ]]; then
      printf '%s\n' 'Usage: bash build.sh android <android.jar> <build-tools-dir> <Tencent SDK JAR> <support-fragment classes.jar> <unsigned-output.apk> [registered-test-package]' >&2
      exit 2
    fi
    platform_jar=$2
    build_tools=$3
    sdk_jar=$4
    fragment_jar=$5
    output=$6
    application_id=${7:-com.yiqikan.app}
    build_dir=$(mktemp -d "${TMPDIR:-/tmp}/yiqikan-qq-build.XXXXXX")
    trap 'rm -rf -- "$build_dir"' EXIT
    mkdir -p "$build_dir/classes" "$build_dir/dex"
    javac -Xlint:-options --release 8 -classpath "$platform_jar:$sdk_jar:$fragment_jar" \
      -d "$build_dir/classes" "$probe_dir/android/QqLoginProbe.java"
    "$build_tools/d8" --release --min-api 24 --lib "$platform_jar" --classpath "$fragment_jar" \
      --output "$build_dir/dex" "$sdk_jar" "$build_dir"/classes/com/yiqikan/app/*.class
    "$build_tools/aapt2" compile --dir "$probe_dir/android/res" -o "$build_dir/resources.zip"
    "$build_tools/aapt2" link -I "$platform_jar" --manifest "$probe_dir/android/AndroidManifest.xml" \
      --rename-manifest-package "$application_id" -o "$build_dir/unaligned.apk" "$build_dir/resources.zip"
    (cd "$build_dir/dex" && zip -q "$build_dir/unaligned.apk" classes*.dex)
    "$build_tools/zipalign" -f 4 "$build_dir/unaligned.apk" "$output"
    printf '%s\n' 'Sign the APK with the certificate registered with QQ. Install it on a separate test device.'
    ;;
  iphonesimulator|iphoneos)
    if [[ $# != 3 ]]; then
      printf '%s\n' 'Usage: bash build.sh <iphonesimulator|iphoneos> <unpacked TencentOpenAPI XCFramework> <output.app>' >&2
      exit 2
    fi
    sdk=$1
    framework_slice=ios-arm64
    platform=arm64-apple-ios16.4
    if [[ $sdk == iphonesimulator ]]; then
      framework_slice=ios-arm64_x86_64-simulator
      platform="$(uname -m)-apple-ios16.4-simulator"
    fi
    app=$3
    mkdir -p "$app"
    cp "$probe_dir/ios/Info.plist" "$app/Info.plist"
    cp "$2/$framework_slice/TencentOpenAPI.framework/PrivacyInfo.xcprivacy" "$app/PrivacyInfo.xcprivacy"
    xcrun --sdk "$sdk" clang -target "$platform" -isysroot "$(xcrun --sdk "$sdk" --show-sdk-path)" \
      -fobjc-arc -F "$2/$framework_slice" -framework TencentOpenAPI -framework UIKit -framework Security \
      -framework CoreTelephony -framework SystemConfiguration -framework CoreGraphics -framework WebKit \
      -lsqlite3 -lz -lc++ -ObjC "$probe_dir/ios/main.m" -o "$app/QQLoginProbe"
    if [[ $sdk == iphonesimulator ]]; then
      codesign --force --sign - "$app"
    else
      printf '%s\n' 'Sign the app with a development profile for com.yiqikan.app with Associated Domains before installing it on a separate test device.'
    fi
    ;;
  *) printf '%s\n' 'Select android, iphonesimulator, or iphoneos.' >&2; exit 2 ;;
esac
