import {
  app,
  ipcMain,
  safeStorage,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  sign,
  type KeyObject,
} from "node:crypto";
import { mkdir, readFile, open, link, unlink } from "node:fs/promises";
import { join } from "node:path";

export function trustedAuthSender(
  event: IpcMainInvokeEvent,
  main: WebContents | null,
  allowedOrigins: string[],
) {
  if (!main || event.sender !== main || event.senderFrame !== main.mainFrame)
    return false;
  try {
    return allowedOrigins.includes(new URL(event.senderFrame.url).origin);
  } catch {
    return false;
  }
}
function rawPublicKey(key: KeyObject) {
  const jwk = key.export({ format: "jwk" });
  return Buffer.concat([
    Buffer.from([4]),
    Buffer.from(jwk.x!, "base64url"),
    Buffer.from(jwk.y!, "base64url"),
  ]).toString("base64");
}
export class DesktopDeviceKeys {
  private keys = new Map<string, Promise<KeyObject>>();
  constructor(
    private directory: () => string,
    private storage = safeStorage,
  ) {}
  private key(scope: string) {
    if (typeof scope !== "string" || !/^[a-zA-Z0-9_:.-]{1,128}$/.test(scope))
      throw new Error("设备凭证范围无效");
    if (
      !this.storage.isEncryptionAvailable() ||
      (process.platform === "linux" &&
        this.storage.getSelectedStorageBackend() === "basic_text")
    )
      throw new Error("系统安全存储不可用，请先启用系统密钥环");
    let pending = this.keys.get(scope);
    if (pending) return pending;
    if (this.keys.size >= 64) throw new Error("设备凭证数量过多");
    pending = (async () => {
      await mkdir(this.directory(), { recursive: true, mode: 0o700 });
      const filename = join(
        this.directory(),
        `${createHash("sha256").update(scope).digest("hex")}.key`,
      );
      try {
        return createPrivateKey(
          this.storage.decryptString(await readFile(filename)),
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const { privateKey } = generateKeyPairSync("ec", {
        namedCurve: "prime256v1",
      });
      const encrypted = this.storage.encryptString(
        privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      );
      const temporary = `${filename}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(encrypted);
          await file.sync();
        } finally {
          await file.close();
        }
        try {
          // Publish a fully written file without overwriting another process's key.
          await link(temporary, filename);
          return privateKey;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          return createPrivateKey(
            this.storage.decryptString(await readFile(filename)),
          );
        }
      } finally {
        await unlink(temporary).catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        });
      }
    })().catch((error) => {
      this.keys.delete(scope);
      throw error;
    });
    this.keys.set(scope, pending);
    return pending;
  }
  async publicKey(scope: string) {
    return rawPublicKey(createPublicKey(await this.key(scope)));
  }
  async sign(scope: string, message: string) {
    if (typeof message !== "string" || message.length > 4096)
      throw new Error("设备验证挑战无效");
    const fields = JSON.parse(message);
    if (
      !Array.isArray(fields) ||
      fields.length !== 8 ||
      fields[0] !== "yiqikan.auth.v2" ||
      !["login", "socket"].includes(fields[1]) ||
      fields[4] !== (await this.publicKey(scope))
    )
      throw new Error("设备验证挑战无效");
    return sign("sha256", Buffer.from(message), await this.key(scope)).toString(
      "base64",
    );
  }
}
export function registerDeviceAuthIpc(
  main: () => WebContents | null,
  allowedOrigins: string[],
) {
  const keys = new DesktopDeviceKeys(() =>
    join(app.getPath("userData"), "device-credentials"),
  );
  const scopeFor = (event: IpcMainInvokeEvent, scope: string) => {
    if (!trustedAuthSender(event, main(), allowedOrigins))
      throw new Error("该页面无权使用设备凭证");
    if (typeof scope !== "string" || scope.length > 128)
      throw new Error("设备凭证范围无效");
    // Partition credentials by both trusted website origin and account profile.
    return createHash("sha256")
      .update(`${new URL(event.senderFrame!.url).origin}:${scope}`)
      .digest("hex");
  };
  ipcMain.handle("yiqikan:device-auth-public-key", (event, scope: string) =>
    keys.publicKey(scopeFor(event, scope)),
  );
  ipcMain.handle(
    "yiqikan:device-auth-sign",
    (event, scope: string, message: string) =>
      keys.sign(scopeFor(event, scope), message),
  );
}
