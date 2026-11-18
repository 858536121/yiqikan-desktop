# QQ 登录联调

在 `apps/mobile/modules/qq-login/sdk/` 放入腾讯官方 Android SDK JAR（`tencent-login.jar`）、Google `support-fragment:28.0.0` AAR 中的 `classes.jar`（`support-fragment.jar`），以及解包后的 `TencentOpenAPI.xcframework`。只需准备要测试的平台对应的文件。

1. 用 `QQ_LOGIN_PROBE_ENABLED=1` 启动 Web 开发服务。
2. 构建联调用 App 时设置 `YIQIKAN_QQ_PROBE_NATIVE=1` 和 `EXPO_PUBLIC_QQ_LOGIN_PROBE_URL`。Android 真机可以通过 `adb reverse tcp:3103 tcp:3103` 使用 `http://127.0.0.1:3103`。远程访问开发服务时使用 HTTPS。
3. Android 包使用 QQ 互联登记的签名。iOS 使用该开关生成 Expo 原生配置并安装 Pods，再使用包含 Associated Domains 的开发签名。iOS 真机回跳还需要线上提供 `apple-app-site-association`，并通过 QQ 互联的通用链接校验。
4. 打开「我的 → 设置 → QQ 登录联调」，用同一个 QQ 分别授权，比较后端返回的身份指纹。联调只校验 QQ 授权，不会创建或绑定异起看账号。

`build.sh` 也能构建独立原生探针。Android 可以追加已登记的测试包名作为最后一个参数，让探针与正式版并存。用 `QQ_LOGIN_PROBE_ENABLED=1 pnpm --dir apps/web exec next dev --hostname 127.0.0.1 --port 3321` 启动开发服务，再用 `adb reverse tcp:3321 tcp:3321` 连接独立 Android 探针。探针会比对 SDK 和后端返回的身份。独立 iOS 探针用于检查 SDK 回跳。

## 测试 App 的账号功能

先在所用的开发数据库应用 Prisma 迁移，再用 `YIQIKAN_QQ_LOGIN_ENABLED=1` 启动实时服务。Web 网关和实时服务需要同时更新。App 的 Web 地址使用 HTTPS，USB 转发至开发服务时可以使用 `http://127.0.0.1`。

准备对应 SDK 后，为原生构建设置 `YIQIKAN_QQ_LOGIN_NATIVE=1`，为 JS 打包设置 `EXPO_PUBLIC_QQ_LOGIN_ENABLED=1`。本地打 iOS 包时，可以把 JS 开关放在 `apps/mobile/.env.local`，并在原生项目生成和安装 Pods 时都传入原生开关。内部测试包也可以用 `YIQIKAN_QQ_PROBE_NATIVE=1` 代替原生开关，以使用本次打包内嵌的 JS。

```sh
cd apps/mobile
YIQIKAN_QQ_LOGIN_NATIVE=1 pnpm exec expo prebuild --platform ios --no-install
cd ios
YIQIKAN_QQ_LOGIN_NATIVE=1 pod install
```

打开生成的 Xcode workspace，选择支持当前 Expo SDK 的 Xcode 工具链、`com.yiqikan.app` 的开发签名和真机。验证线上 `apple-app-site-association` 以及 QQ 互联的 iOS 通用链接后，在「我的 → 账号与登录」点击「QQ 登录」。首次使用的 QQ 关联当前游客账号，再次登录会恢复该 QQ 已关联的账号。授权后可以选择导入 QQ 昵称和头像。头像保存腾讯链接，其他客户端通过既有头像路径跳转到腾讯加载图片。

确认退出账号后恢复游客、再次登录恢复原用户编号，邮箱密码重置后旧邮箱设备需要重新验证。片单和观看记录保留在本机。邮箱注册和找回密码复用 Web 邮件服务，生产环境需要配置 `EMAIL_USER` 和 `EMAIL_PASS`。

SDK 文件默认不进 Git，远程构建时需要把相应 SDK 作为构建输入提供。
