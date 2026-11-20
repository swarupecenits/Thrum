package expo.modules.thrumaudio.sound

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper

/**
 * Tracks where music is going (speaker, wired, USB DAC, a specific Bluetooth headset) so each
 * output can keep its own sound profile.
 */
class RouteMonitor(context: Context, private val onRoute: (Route) -> Unit) {
  data class Route(val kind: String, val name: String, val key: String) {
    fun toMap(): Map<String, Any?> = mapOf("kind" to kind, "name" to name, "key" to key)
  }

  private val audio = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
  private val handler = Handler(Looper.getMainLooper())
  private var started = false

  @Volatile var current: Route = compute()
    private set

  private val settle = Runnable {
    val route = compute()
    if (route != current) {
      current = route
      onRoute(route)
    }
  }

  private val callback = object : AudioDeviceCallback() {
    override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = schedule()
    override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = schedule()
  }

  fun start() {
    if (started) return
    started = true
    audio.registerAudioDeviceCallback(callback, handler)
  }

  fun stop() {
    if (!started) return
    started = false
    audio.unregisterAudioDeviceCallback(callback)
    handler.removeCallbacks(settle)
  }

  private fun schedule() {
    handler.removeCallbacks(settle)
    handler.postDelayed(settle, SETTLE_MS)
  }

  fun compute(): Route {
    val outputs = runCatching { audio.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList() }.getOrDefault(emptyList())
    val active = activeType()
    val device = active?.let { type -> outputs.firstOrNull { it.type == type } }
      ?: outputs.filter { rank(it.type) < Int.MAX_VALUE }.minByOrNull { rank(it.type) }
    return describe(device)
  }

  /** API 33+ can tell us the device media is actually routed to. */
  private fun activeType(): Int? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return null
    return runCatching {
      val attributes = AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA)
        .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
        .build()
      audio.getAudioDevicesForAttributes(attributes).firstOrNull()?.type
    }.getOrNull()
  }

  private fun describe(device: AudioDeviceInfo?): Route {
    val type = device?.type ?: AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
    val product = device?.productName?.toString()?.trim().orEmpty()
    return when (kindOf(type)) {
      "bluetooth" -> {
        val name = product.ifEmpty { "Bluetooth" }
        Route("bluetooth", name, "bluetooth:$name")
      }
      "usb" -> {
        val name = product.ifEmpty { "USB audio" }
        Route("usb", name, "usb:$name")
      }
      "wired" -> Route("wired", "Wired headphones", "wired")
      "other" -> Route("other", product.ifEmpty { "External output" }, "other:$type")
      else -> Route("speaker", "Phone speaker", "speaker")
    }
  }

  private companion object {
    const val SETTLE_MS = 250L

    val BLUETOOTH = setOf(
      AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
      AudioDeviceInfo.TYPE_HEARING_AID,
      26, // TYPE_BLE_HEADSET (API 31)
      27, // TYPE_BLE_SPEAKER (API 31)
      30, // TYPE_BLE_BROADCAST (API 33)
    )
    val USB = setOf(
      AudioDeviceInfo.TYPE_USB_HEADSET,
      AudioDeviceInfo.TYPE_USB_DEVICE,
      AudioDeviceInfo.TYPE_USB_ACCESSORY,
    )
    val WIRED = setOf(
      AudioDeviceInfo.TYPE_WIRED_HEADSET,
      AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
      AudioDeviceInfo.TYPE_LINE_ANALOG,
      AudioDeviceInfo.TYPE_LINE_DIGITAL,
      AudioDeviceInfo.TYPE_AUX_LINE,
    )
    val OTHER = setOf(
      AudioDeviceInfo.TYPE_HDMI,
      AudioDeviceInfo.TYPE_HDMI_ARC,
      AudioDeviceInfo.TYPE_DOCK,
      29, // TYPE_HDMI_EARC (API 31)
    )

    fun kindOf(type: Int): String = when (type) {
      in BLUETOOTH -> "bluetooth"
      in USB -> "usb"
      in WIRED -> "wired"
      in OTHER -> "other"
      else -> "speaker"
    }

    fun rank(type: Int): Int = when (type) {
      in BLUETOOTH -> 0
      in USB -> 1
      in WIRED -> 2
      in OTHER -> 3
      AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> 4
      else -> Int.MAX_VALUE
    }
  }
}
