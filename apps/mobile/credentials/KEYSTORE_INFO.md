# 异起看 (YiQikan) 备案资质与正式签名凭据手册

本文档记录异起看项目在各大应用商店、工信部 ICP 备案、公安联网备案及第三方开放平台所需的所有证书指纹、公钥和备案关键数据，便于后续发版、更新与合规核验。

---

## 1. 备案基本信息

| 项目 | 参数值 | 说明 |
| :--- | :--- | :--- |
| **主体名称** | 林存硕 | 个人主体 |
| **工信部主体备案号** | `鲁ICP备2026053440号` | 状态：正常 |
| **网站服务备案号** | `鲁ICP备2026053440号-1` | 对应网站：`yiqikan.club` |
| **主域名** | `yiqikan.club` | 阿里云万网注册，腾讯云境内接入 |
| **服务器公网 IP** | `124.221.252.171` | 腾讯云上海轻量应用服务器 |
| **公安联网备案状态** | 审核中 | 已提交至山东省济南市市中区网安大队 |
| **APP ICP 备案状态** | 填报中 | 腾讯云代备案系统 |

---

## 2. 移动端应用基本信息 (Mobile App)

| 配置项 | 参数值 | 备注 |
| :--- | :--- | :--- |
| **APP 名称** | 异起看 | 图标与应用市场显示名称 |
| **Android 包名** | `com.yiqikan.app` | 位于 `apps/mobile/app.json` |
| **iOS Bundle ID** | `com.yiqikan.app` | 位于 `apps/mobile/app.json` |
| **APP 分类** | 信息传输、软件和信息技术服务业 -> 软件开发 | 个人合规分类，免特殊前置审批 |
| **对外/使用外部 SDK** | 不提供 / 不使用 | 纯净原生与轻量组件 |
| **APP 图标文件** | `apps/mobile/assets/icon.png` | 1024x1024 标准应用图标 |

---

## 3. Android 官方正式签名证书 (Release Keystore)

文件位置：`apps/mobile/credentials/yiqikan-release.keystore`（项目内软链/副本：`apps/mobile/android/app/yiqikan-release.keystore`）。

### 3.1 密钥参数
* **密钥库格式**：PKCS12 (RSA 2048 位)
* **密钥库密码 (Store Password)**：`yiqikan2026`
* **密钥别名 (Key Alias)**：`yiqikan-key-alias`
* **密钥密码 (Key Password)**：`yiqikan2026`
* **证书所有者**：`CN=Yiqikan, OU=Mobile, O=Yiqikan, L=Beijing, ST=Beijing, C=CN`
* **有效期至**：2054年1月19日

---

### 3.2 证书指纹（各平台上架与开放平台专用）

#### ① 签名 MD5 值（微信开放平台 / 工信部 APP 备案必填）
* **32 位纯十六进制（小写无冒号，微信/腾讯云首选）**：
  ```text
  bff757154a4d58afb68f918605c14882
  ```
* **带冒号格式（大写备用）**：
  ```text
  BF:F7:57:15:4A:4D:58:AF:B6:8F:91:86:05:C1:48:82
  ```

#### ② SHA-256 指纹（工信部 APP 备案 / 华为 / 小米 / 荣耀必填）
```text
DB:D2:16:8C:B8:B5:73:CE:1F:F5:28:0F:0E:E1:F8:6C:CA:5E:22:2F:13:5A:04:C4:F3:A8:DC:33:6D:CF:63:BE
```

#### ③ SHA-1 指纹（高德 / 百度地图 / 历史平台备用）
```text
E7:45:1B:15:78:6F:E4:8A:1F:26:1A:7B:C6:2B:1B:5C:C1:01:61:E8
```

#### ④ 证书序列号
```text
1f1bf99481694f95
```

---

### 3.3 证书公钥 (Public Key / Modulus)

#### ① RSA Modulus 十六进制字符串（工信部 APP 备案特征信息必填）
```text
A11EE687DE42AB173A1843FF03C7CF139A4A357973F75C7755725010907329AAE3CB5D1B6578F15B7CD0446483762E8FB4AEBF8CF0820475AA82AB02C0204E69BAE259DA440318D5A2501B22B92C8B521CABAFD8D8ADE8916020089D48FB1285DD3EB5D75A20556AEDC45DD2371503D24294B704D8973813DF44F737D76A89196F9B9E7FB9FBB6B97B0A02A281D81E65F1032D2BD9EB77FFC7D12CC4F50ECA516204365D00C4CE4090C4F1F9A217ACDD3FBD0F4283D00058EE38F2A6B24ED51675028EF9250279C4C9683D35DF276E1893E09422C62A3AFFB17B3CBC0BD67436EDAA24772301C3FA7F15DA39AAB06843ADD63B8D8EC4FE99D28BCCC022374F4F
```

#### ② 标准 PEM 公钥 (Base64)
```text
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAoR7mh95Cqxc6GEP/A8fP
E5pKNXlz91x3VXJQEJBzKarjy10bZXjxW3zQRGSDdi6PtK6/jPCCBHWqgqsCwCBO
abriWdpEAxjVolAbIrksi1Icq6/Y2K3okWAgCJ1I+xKF3T6111ogVWrtxF3SNxUD
0kKUtwTYlzgT30T3N9dqiRlvm55/ufu2uXsKAqKB2B5l8QMtK9nrd//H0SzE9Q7K
UWIENl0AxM5AkMTx+aIXrN0/vQ9Cg9AAWO448qayTtUWdQKO+SUCecTJaD013ydu
GJPglCLGKjr/sXs8vAvWdDbtqiR3IwHD+n8V2jmqsGhDrdY7jY7E/pnSi8zAIjdP
TwIDAQAB
-----END PUBLIC KEY-----
```

---

## 4. 常用验证与查看命令

```bash
# 查看完整证书指纹
keytool -list -v -keystore apps/mobile/credentials/yiqikan-release.keystore -storepass yiqikan2026 -alias yiqikan-key-alias

# 提取 RSA Modulus 十六进制公钥
keytool -exportcert -rfc -keystore apps/mobile/credentials/yiqikan-release.keystore -alias yiqikan-key-alias -storepass yiqikan2026 | openssl x509 -noout -modulus

# 计算 MD5 指纹
keytool -exportcert -keystore apps/mobile/credentials/yiqikan-release.keystore -alias yiqikan-key-alias -storepass yiqikan2026 | openssl md5
```
