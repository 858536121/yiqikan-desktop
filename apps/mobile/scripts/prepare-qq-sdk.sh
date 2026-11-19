#!/usr/bin/env bash
set -euo pipefail

# EAS invokes the hook without arguments for every build profile.
if [[ $# -eq 0 && ${YIQIKAN_QQ_LOGIN_NATIVE:-} != 1 && ${YIQIKAN_QQ_PROBE_NATIVE:-} != 1 ]]; then
  exit 0
fi

platform=${1:-${EAS_BUILD_PLATFORM:-}}
sdk_dir=$(cd -- "$(dirname -- "$0")/../modules/qq-login" && pwd)/sdk
work_dir=$(mktemp -d "${TMPDIR:-/tmp}/yiqikan-qq-sdk.XXXXXX")
trap 'rm -rf -- "$work_dir"' EXIT
cd "$work_dir"

download() {
  local url=$1 file=$2 digest=$3
  curl --fail --silent --show-error --location --proto '=https' --proto-redir '=https' \
    --retry 3 --connect-timeout 15 --max-time 120 --output "$file" "$url"
  printf '%s  %s\n' "$digest" "$file" | shasum -a 256 --check
}

# Tencent publishes the exact archives at https://wiki.connect.qq.com/sdk下载/.
case "$platform" in
  ios)
    download 'https://tangram-1251316161.file.myqcloud.com/files/20261030/8c572807d00ffda26d522fadceac7eca.zip' \
      ios.zip 38a2fb7f26d8de683b942e16c5c1e46aeb054810d193bab0292686f8e5c74ae1
    unzip -p ios.zip 'TencentOpenAPI.xcframework(Lite).zip' > xcframework.zip
    unzip -q xcframework.zip -d TencentOpenAPI.xcframework
    test -f TencentOpenAPI.xcframework/Info.plist
    mkdir -p "$sdk_dir/TencentOpenAPI.xcframework"
    cp -R TencentOpenAPI.xcframework/. "$sdk_dir/TencentOpenAPI.xcframework/"
    printf '%s\n' 'Prepared Tencent QQ SDK 3.6.22 for iOS.'
    ;;
  android)
    download 'https://tangram-1251316161.file.myqcloud.com/files/20260414/143310b667ece8922594fbe866dabdef.zip' \
      android.zip 6272d4123d8327400a655c48f1fb7eb24b83fd5beeb527951ed100b219192b9b
    download 'https://dl.google.com/dl/android/maven2/com/android/support/support-fragment/28.0.0/support-fragment-28.0.0.aar' \
      support-fragment.aar 3772fc738ada86824ba1a4b3f197c3dbd67b7ddcfe2c9db1de95ef2e3487a915
    unzip -p android.zip 'open_sdk_3.5.19_r9483ffc7_lite.jar' > tencent-login.jar
    unzip -p support-fragment.aar classes.jar > support-fragment.jar
    mkdir -p "$sdk_dir"
    cp tencent-login.jar support-fragment.jar "$sdk_dir/"
    printf '%s\n' 'Prepared Tencent QQ SDK 3.5.19 for Android.'
    ;;
  *) printf 'Unsupported QQ SDK platform: %s\n' "$platform" >&2; exit 2 ;;
esac
