package expo.modules.thrumaudio.sound

import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import expo.modules.thrumaudio.dsp.DspEngine
import expo.modules.thrumaudio.dsp.SoundParams
import java.util.concurrent.ConcurrentHashMap

/**
 * The sound "brain": current DSP parameters and per-output profiles, persisted natively so playback
 * resumed by the system (no JS running) still sounds exactly right. Bypass is the momentary
 * hold-to-compare, so it is never persisted: every process starts with your sound on.
 *
 * Per-device mode: every output remembers its own tuning; an output seen for the first time starts
 * from the most recent tuning, so a new pair of buds inherits your bass instead of going flat.
 */
object SoundCenter {
  private const val PREFS = "thrum_sound"
  private const val PROFILE_PREFIX = "profile:"
  private const val WRITE_DEBOUNCE_MS = 400L

  private lateinit var app: Context
  private lateinit var prefs: SharedPreferences
  private val main = Handler(Looper.getMainLooper())
  private val profiles = ConcurrentHashMap<String, SoundParams>()
  private val pendingWrites = ConcurrentHashMap<String, String>()
  private var monitor: RouteMonitor? = null

  @Volatile private var params: SoundParams = SoundParams.THRUM_DEFAULT
  @Volatile private var latest: SoundParams = SoundParams.THRUM_DEFAULT
  @Volatile private var perDevice = true
  @Volatile private var route = RouteMonitor.Route("speaker", "Phone speaker", "speaker")

  /** (route, soundState) for the `onRoute` event. */
  @Volatile var listener: ((Map<String, Any?>, Map<String, Any?>) -> Unit)? = null

  @Synchronized
  fun init(context: Context) {
    if (::prefs.isInitialized) return
    app = context.applicationContext
    prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    perDevice = prefs.getBoolean("perDevice", true)
    for ((key, value) in prefs.all) {
      if (key.startsWith(PROFILE_PREFIX) && value is String) {
        SoundParams.fromJson(value)?.let { profiles[key.removePrefix(PROFILE_PREFIX)] = it }
      }
    }
    latest = prefs.getString("global", null)?.let { SoundParams.fromJson(it) } ?: SoundParams.THRUM_DEFAULT
    val routes = RouteMonitor(app) { onRouteChanged(it) }
    monitor = routes
    route = routes.current
    params = paramsFor(route)
    DspEngine.update(params)
    routes.start()
  }

  private fun paramsFor(route: RouteMonitor.Route): SoundParams =
    if (perDevice) profiles[route.key] ?: latest else latest

  @Synchronized
  private fun onRouteChanged(next: RouteMonitor.Route) {
    route = next
    if (perDevice) {
      params = paramsFor(next)
      DspEngine.update(params)
    }
    listener?.invoke(next.toMap(), stateLocked())
  }

  @Synchronized
  fun setSound(map: Map<String, Any?>): Map<String, Any?> {
    val next = SoundParams.fromMap(map, params)
    params = next
    latest = next
    DspEngine.update(next)
    val json = next.toJson()
    if (perDevice) {
      profiles[route.key] = next
      write(PROFILE_PREFIX + route.key, json)
    }
    write("global", json)
    return stateLocked()
  }

  @Synchronized
  fun setPerDevice(enabled: Boolean): Map<String, Any?> {
    if (enabled != perDevice) {
      perDevice = enabled
      prefs.edit().putBoolean("perDevice", enabled).apply()
      if (enabled) {
        // Adopt what you hear right now as this output's profile.
        profiles[route.key] = params
        write(PROFILE_PREFIX + route.key, params.toJson())
      } else {
        latest = params
        write("global", params.toJson())
      }
    }
    return stateLocked()
  }

  @Synchronized
  fun setBypass(bypass: Boolean): Map<String, Any?> {
    DspEngine.setBypass(bypass)
    return stateLocked()
  }

  @Synchronized
  fun state(): Map<String, Any?> = stateLocked()

  private fun stateLocked(): Map<String, Any?> = mapOf(
    "params" to params.toMap(),
    "route" to route.toMap(),
    "perDevice" to perDevice,
    "profiles" to profiles.mapValues { it.value.toMap() },
    "headroomDb" to DspEngine.headroomDb.toDouble(),
    "bypass" to DspEngine.bypass,
  )

  /** Slider drags call setSound ~60x/s; coalesce the disk writes. */
  private fun write(key: String, json: String) {
    pendingWrites[key] = json
    main.removeCallbacks(flush)
    main.postDelayed(flush, WRITE_DEBOUNCE_MS)
  }

  private val flush = Runnable {
    if (pendingWrites.isEmpty()) return@Runnable
    val editor = prefs.edit()
    for (key in pendingWrites.keys.toList()) {
      pendingWrites.remove(key)?.let { editor.putString(key, it) }
    }
    editor.apply()
  }
}
