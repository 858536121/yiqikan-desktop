# 异起看 Android 官方正式签名证书信息 (Release Keystore)

此密钥库用于异起看 (YiVideo) Android 客户端的正式生产发布签名。

---

## 1. 证书核心参数

| 配置项 | 参数值 |
| :--- | :--- |
| **密钥库文件** | `yiqikan-release.keystore` |
| **密钥库格式** | PKCS12 (RSA 2048 位) |
| **密钥库密码 (Store Password)** | `yiqikan2026` |
| **密钥别名 (Key Alias)** | `yiqikan-key-alias` |
| **密钥密码 (Key Password)** | `yiqikan2026` |
| **证书所有者 / 组织** | `CN=Yiqikan, OU=Mobile, O=Yiqikan, L=Beijing, ST=Beijing, C=CN` |
| **有效期** | 10,000 天（至 2054 年 1 月 19 日） |

---

## 2. 证书指纹信息（工信部 App 备案 / 微信开放平台必填）

* **SHA-256 指纹**：
  `DB:D2:16:8C:B8:B5:73:CE:1F:F5:28:0F:0E:E1:F8:6C:CA:5E:22:2F:13:5A:04:C4:F3:A8:DC:33:6D:CF:63:BE`
* **SHA-1 指纹**：
  `E7:45:1B:15:78:6F:E4:8A:1F:26:1A:7B:C6:2B:1B:5C:C1:01:61:E8`
* **证书序列号**：
  `1f1bf99481694f95`

---

## 3. 如何查看证书详情
在终端执行：
```bash
keytool -list -v -keystore apps/mobile/credentials/yiqikan-release.keystore -storepass yiqikan2026
```
