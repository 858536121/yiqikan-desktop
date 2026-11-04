package com.yiqikan.app.security

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import com.facebook.react.bridge.*
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.Signature
import java.security.interfaces.ECPublicKey
import java.security.spec.ECGenParameterSpec
import org.json.JSONArray

class DeviceAuthModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = "YiqikanDeviceAuth"
  private fun alias(origin: String): String {
    require(origin.isNotEmpty() && origin.length <= 300)
    return "yiqikan.auth.v2." + MessageDigest.getInstance("SHA-256").digest(origin.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }
  }
  @Synchronized private fun key(origin: String): KeyStore.PrivateKeyEntry {
    val name = alias(origin)
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (!store.containsAlias(name)) {
      val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, "AndroidKeyStore")
      generator.initialize(KeyGenParameterSpec.Builder(name, KeyProperties.PURPOSE_SIGN)
        .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
        .setDigests(KeyProperties.DIGEST_SHA256).setUserAuthenticationRequired(false).build())
      generator.generateKeyPair()
    }
    return store.getEntry(name, null) as KeyStore.PrivateKeyEntry
  }
  private fun publicBytes(entry: KeyStore.PrivateKeyEntry): ByteArray {
    val pub = entry.certificate.publicKey as ECPublicKey
    val bytes = ByteArray(65); bytes[0] = 4
    for ((offset, coordinate) in listOf(1 to pub.w.affineX, 33 to pub.w.affineY)) {
      val raw = coordinate.toByteArray()
      val length = minOf(32, raw.size)
      System.arraycopy(raw, raw.size - length, bytes, offset + 32 - length, length)
    }
    return bytes
  }
  @ReactMethod fun publicKey(origin: String, promise: Promise) {
    try { promise.resolve(Base64.encodeToString(publicBytes(key(origin)), Base64.NO_WRAP)) }
    catch (error: Exception) { promise.reject("KEY_UNAVAILABLE", "设备密钥暂不可用", error) }
  }
  @ReactMethod fun sign(origin: String, message: String, promise: Promise) {
    try {
      require(message.length <= 4096)
      val entry = key(origin)
      val fields = JSONArray(message)
      require(fields.length() == 8 && fields.getString(0) == "yiqikan.auth.v2" && fields.getString(1) in listOf("login", "socket") && fields.getString(4) == Base64.encodeToString(publicBytes(entry), Base64.NO_WRAP))
      val signer = Signature.getInstance("SHA256withECDSA").apply { initSign(entry.privateKey); update(message.toByteArray(Charsets.UTF_8)) }
      promise.resolve(Base64.encodeToString(signer.sign(), Base64.NO_WRAP))
    } catch (error: Exception) { promise.reject("SIGN_FAILED", "设备验证失败", error) }
  }
}
