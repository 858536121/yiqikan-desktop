package com.yiqikan.app.player

import android.content.Context
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.ViewTreeObserver
import android.view.Window
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import com.facebook.react.bridge.*
import kotlin.math.abs
import kotlin.math.roundToInt

class PlayerDeviceModule(private val context: ReactApplicationContext) : ReactContextBaseJavaModule(context), LifecycleEventListener, ViewTreeObserver.OnWindowFocusChangeListener {
  private val main = Handler(Looper.getMainLooper())
  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private var session: Double? = null
  private var window: android.view.Window? = null
  private var originalBrightness = -1f
  private var writtenBrightness: Float? = null
  // Fullscreen belongs to the player presentation, independently of brightness
  // sessions (which end whenever the app goes into the background).
  private var fullscreen = false
  private var fullscreenWindow: Window? = null
  private var navigationWasVisible = true
  private var originalBarsBehavior = 0
  init { context.addLifecycleEventListener(this) }
  override fun getName() = "YiqikanPlayerDevice"
  // Android's existing voice backend is WebView audio. Select the current
  // communication stream only if the OS has actually entered a call mode.
  private fun stream() = if (audio.mode == AudioManager.MODE_IN_COMMUNICATION || audio.mode == AudioManager.MODE_IN_CALL)
    AudioManager.STREAM_VOICE_CALL else AudioManager.STREAM_MUSIC
  private fun snapshot(): WritableMap {
    val stream = stream()
    val min = if (android.os.Build.VERSION.SDK_INT >= 28) audio.getStreamMinVolume(stream) else 0
    val max = audio.getStreamMaxVolume(stream)
    val brightness = window?.attributes?.screenBrightness?.takeIf { it >= 0 }
      ?: (Settings.System.getInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, 128) / 255f)
    val route = audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).joinToString("|") { "${it.id}:${it.type}" } + ":$stream"
    return Arguments.createMap().apply {
      putDouble("brightness", brightness.toDouble())
      putDouble("volume", if (max > 0) audio.getStreamVolume(stream).toDouble() / max else 0.0)
      putBoolean("canBrightness", session != null && window != null)
      putBoolean("canVolume", session != null && !audio.isVolumeFixed && max > min)
      putString("route", route)
      putBoolean("active", session != null)
    }
  }
  private fun finish() {
    val owned = window
    val written = writtenBrightness
    if (owned != null && written != null && abs(owned.attributes.screenBrightness - written) < .015f) {
      owned.attributes = owned.attributes.apply { screenBrightness = originalBrightness }
    }
    session = null; window = null; writtenBrightness = null
  }
  private fun run(token: Double, promise: Promise, action: () -> Unit = {}) {
    main.post {
      try {
        check(session == token && window != null) { "播放器控制已结束" }
        action(); promise.resolve(snapshot())
      } catch (error: Exception) { promise.reject("PLAYER_DEVICE", error.message, error) }
    }
  }
  @ReactMethod fun begin(token: Double, promise: Promise) {
    main.post {
      try {
        finish()
        check(context.lifecycleState == com.facebook.react.common.LifecycleState.RESUMED) { "播放器未在前台" }
        val activity = context.currentActivity ?: error("播放器未在前台")
        window = activity.window; originalBrightness = activity.window.attributes.screenBrightness; session = token
        promise.resolve(snapshot())
      } catch (error: Exception) { finish(); promise.reject("PLAYER_DEVICE", error.message, error) }
    }
  }
  @ReactMethod fun read(token: Double, promise: Promise) = run(token, promise)
  @ReactMethod fun setBrightness(token: Double, value: Double, promise: Promise) = run(token, promise) {
    require(value.isFinite())
    val next = value.coerceIn(.05, 1.0).toFloat()
    writtenBrightness = next
    window!!.attributes = window!!.attributes.apply { screenBrightness = next }
  }
  @ReactMethod fun setVolume(token: Double, value: Double, route: String, promise: Promise) = run(token, promise) {
    require(value.isFinite() && !audio.isVolumeFixed)
    check(snapshot().getString("route") == route) { "音频输出已切换，请重新调节" }
    val stream = stream()
    val min = if (android.os.Build.VERSION.SDK_INT >= 28) audio.getStreamMinVolume(stream) else 0
    val max = audio.getStreamMaxVolume(stream)
    audio.setStreamVolume(stream, (value.coerceIn(0.0, 1.0) * max).roundToInt().coerceIn(min, max), 0)
  }
  @ReactMethod fun end(token: Double) { main.post { if (session == token) finish() } }
  @ReactMethod fun setFullscreen(enabled: Boolean, promise: Promise) {
    main.post {
      try {
        fullscreen = enabled
        if (enabled) applyFullscreen() else restoreNavigation()
        promise.resolve(null)
      } catch (error: Exception) { promise.reject("PLAYER_FULLSCREEN", error.message, error) }
    }
  }
  private fun applyFullscreen() {
    if (!fullscreen) return
    val target = context.currentActivity?.window ?: return
    if (fullscreenWindow !== target) {
      restoreNavigation()
      fullscreenWindow = target
      navigationWasVisible = ViewCompat.getRootWindowInsets(target.decorView)
        ?.isVisible(WindowInsetsCompat.Type.navigationBars()) ?: true
      originalBarsBehavior = WindowCompat.getInsetsController(target, target.decorView).systemBarsBehavior
      target.decorView.viewTreeObserver.addOnWindowFocusChangeListener(this)
    }
    WindowCompat.getInsetsController(target, target.decorView).apply {
      systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
      hide(WindowInsetsCompat.Type.navigationBars())
    }
  }
  private fun restoreNavigation() {
    val target = fullscreenWindow ?: return
    fullscreenWindow = null
    val observer = target.decorView.viewTreeObserver
    if (observer.isAlive) observer.removeOnWindowFocusChangeListener(this)
    WindowCompat.getInsetsController(target, target.decorView).apply {
      systemBarsBehavior = originalBarsBehavior
      if (navigationWasVisible) show(WindowInsetsCompat.Type.navigationBars())
      else hide(WindowInsetsCompat.Type.navigationBars())
    }
  }
  override fun onWindowFocusChanged(hasFocus: Boolean) { if (hasFocus) main.post { applyFullscreen() } }
  override fun onHostResume() { main.post { applyFullscreen() } }
  override fun onHostPause() { finish() }
  override fun onHostDestroy() { finish(); fullscreen = false; restoreNavigation() }
  override fun invalidate() {
    context.removeLifecycleEventListener(this)
    main.post { finish(); fullscreen = false; restoreNavigation() }
    super.invalidate()
  }
}
