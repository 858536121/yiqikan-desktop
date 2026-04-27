# 发布指南

## 版本号规则

版本号唯一真相是 `apps/desktop/package.json` 的 `version` 字段（SemVer）。

| 场景 | 版本变化 | 示例 |
|---|---|---|
| 纯页面改动（renderer 热更） | 不变 | 0.2.4 → 0.2.4 |
| 新功能 / 小改动（壳有变化） | patch | 0.2.4 → 0.2.5 |
| 较大功能迭代 | minor | 0.2.4 → 0.3.0 |
| 破坏性改动 / 架构重写 | major | 0.2.4 → 1.0.0 |

**Renderer 版本号 = 壳版本 + 构建时间戳**，格式 `0.2.5-202604261830`，由 `release-renderer.sh` 自动生成，不需要手动维护。每次发布都会产生新版本号，确保 app 能检测到更新。

---

## 两种发布场景

### 场景 A：日常页面改动（renderer 热更）

适用于：只改了 `apps/desktop/src/renderer/` 下的代码，主进程 / preload 没有变动。

```bash
# 1. 构建 renderer → 打 zip → 放到 web/public/releases/
pnpm release:renderer

# 2. 提交 zip 并部署 web（带上新 zip）
git add apps/web/public/releases/
git commit -m "release: renderer v$(node -p "require('./apps/desktop/package.json').version")"
pnpm deploy

# 3. 在 admin 后台更新 rendererVersion 和 rendererUrl（若未配置自动更新）
#    或者用一条命令全自动完成步骤 1-3：
ADMIN_URL=https://yiqikan.cpolar.cn ADMIN_USER=admin ADMIN_PASS=xxx pnpm release:renderer
git add apps/web/public/releases/
git commit -m "release: renderer vx.x.x"
pnpm deploy
```

用户下次启动 app 时后台静默下载新 renderer，重启后生效，**无感知**。

---

### 场景 B：壳有改动（需要全量更新）

适用于：改了主进程 `src/main/`、preload `src/preload/`、依赖版本、Electron 版本等。

```bash
# 1. 升版本号（自动改 package.json 并打 git tag）
pnpm --filter @yiqikan/desktop version patch   # 或 minor / major

# 2. 同步根 package.json 版本（保持一致）
# 手动编辑根 package.json 的 version 字段与 desktop 保持一致

# 3. 构建 renderer zip 并放到 web
pnpm release:renderer

# 4. 打全量安装包
pnpm dist:mac      # macOS
pnpm dist:win      # Windows

# 5. 把安装包上传到对象存储 / 文件服务，更新 admin 后台的下载链接
#    admin → 下载入口管理 → 填写新的 .dmg / .exe 下载地址

# 6. 提交并部署 web
git add apps/web/public/releases/
git commit -m "release: v$(node -p "require('./apps/desktop/package.json').version")"
pnpm deploy

# 7. 在 admin 后台更新更新策略：
#    shellMinVersion = 新版本号（比如 0.2.5）
#    forceShellUpdate = true/false（是否强制，看改动严重程度）
#    rendererVersion + rendererUrl = 同上
```

---

## Admin 后台更新策略说明

路径：`https://yiqikan.cpolar.cn/admin` → 更新策略管理

| 字段 | 说明 |
|---|---|
| `shellMinVersion` | 要求的最低壳版本。低于此版本的用户会看到更新提示。留空则不检查壳版本。 |
| `forceShellUpdate` | 勾选后弹窗不可关闭，用户必须更新才能继续使用。适用于安全漏洞、协议不兼容等情况。 |
| `rendererVersion` | 当前最新 renderer 版本号，app 启动时与本地已安装版本对比。留空则不热更。 |
| `rendererUrl` | renderer zip 的完整下载地址，格式：`https://yiqikan.cpolar.cn/releases/renderer-x.x.x.zip` |

---

## 环境变量（打包时注入）

Desktop app 的热更功能默认关闭，需要在打包时配置以下环境变量（通过 `.env` 或构建脚本注入）：

| 变量 | 说明 | 示例 |
|---|---|---|
| `YIQIKAN_RELEASE_UPDATE_ENABLED` | 热更总开关 | `1` |
| `YIQIKAN_RELEASE_CONFIG_URL` | release-config API 地址 | `https://yiqikan.cpolar.cn/api/release-config` |
| `YIQIKAN_RELEASE_UPDATE_DELAY_MS` | 启动后延迟检查毫秒数（默认 6000） | `8000` |
| `YIQIKAN_RELEASE_UPDATE_INTERVAL_MS` | 定期检查间隔毫秒数（默认 3600000，即 1 小时） | `3600000` |

壳全量更新（electron-updater）的环境变量：

| 变量 | 说明 |
|---|---|
| `YIQIKAN_UPDATES_ENABLED` | electron-updater 总开关 |
| `YIQIKAN_UPDATES_FEED_URL` | 更新服务器地址（存放 latest.yml 的目录） |
| `YIQIKAN_UPDATES_CHECK_ON_LAUNCH` | 启动时自动检查 |

---

## 文件结构

```
apps/
  desktop/
    src/
      main/
        release-updater.ts   # 热更核心逻辑（检查/下载/切换）
        updater.ts           # electron-updater 壳全量更新
      preload/
        index.ts             # 暴露 bridge 给 renderer
      shared/
        renderer-update.ts   # 热更状态类型定义
        app-update.ts        # 壳更新状态类型定义
    out/
      renderer/              # electron-vite 构建产物（热更打包来源）

  web/
    public/
      releases/              # renderer zip 静态托管目录
        renderer-x.x.x.zip
    app/
      api/
        release-config/      # 公开 GET，desktop app 轮询
        admin/
          release-config/    # admin GET/POST，管理更新策略

scripts/
  release-renderer.sh        # renderer 热更发布脚本
```

---

## 自动判断逻辑（release.sh）

`pnpm release` 会对比上一个 git tag 到 HEAD 的变更，自动决定走哪条路：

| 变更范围 | 判定 | 行为 |
|---|---|---|
| 只有 `src/renderer/` | renderer 热更 | 不 bump 版本，打 zip，commit |
| `src/main/` / `src/preload/` / `package.json` / `electron.vite.config.ts` 任一 | 壳变更 | bump patch，打 zip，commit，打 tag，提示打安装包 |

壳文件判定范围（改了这些 = 需要全量更新）：
- `apps/desktop/src/main/`
- `apps/desktop/src/preload/`
- `apps/desktop/package.json`
- `apps/desktop/electron.vite.config.ts`

---

## 给 AI 的操作规则

- **改了 renderer 代码** → 不需要改版本号，直接 `pnpm release:renderer`
- **改了主进程 / preload / 依赖** → 必须先 `pnpm --filter @yiqikan/desktop version patch` 再发布
- **版本号唯一来源** → `apps/desktop/package.json`，不要在其他地方单独维护版本号
- **不要手动编辑** `apps/web/public/releases/` 下的文件，全部由 `release-renderer.sh` 生成
- **壳版本升级后** → 记得在 admin 更新 `shellMinVersion`，否则旧用户不会收到更新提示
- **`forceShellUpdate`** → 只在协议不兼容、安全漏洞时才设为 true，平时保持 false
