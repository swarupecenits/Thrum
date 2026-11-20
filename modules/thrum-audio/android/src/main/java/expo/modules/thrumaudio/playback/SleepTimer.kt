package expo.modules.thrumaudio.playback

import android.os.Handler
import android.os.Looper
import androidx.annotation.MainThread

/**
 * Sleep timer with a gentle fade. `time` mode stops at a wall-clock moment; `track` mode lets the
 * current song finish (Media3 pauses at the end of the item) and fades its last seconds.
 */
object SleepTimer {
  private val main = Handler(Looper.getMainLooper())
  @Volatile private var mode: String? = null
  @Volatile private var endsAt: Long? = null
  @Volatile private var fadeSec: Int = 0

  fun state(): Map<String, Any?> = mapOf(
    "endsAt" to endsAt?.toDouble(),
    "mode" to mode,
    "fadeSec" to fadeSec,
  )

  @MainThread
  fun set(minutes: Double, mode: String, fadeSec: Int) {
    clear()
    this.fadeSec = fadeSec.coerceIn(0, 120)
    if (mode == "track") {
      this.mode = "track"
      endsAt = null
      PlayerHub.setPauseAtEndOfItem(true)
    } else {
      this.mode = "time"
      val ms = (minutes.coerceIn(0.05, 24.0 * 60.0) * 60_000.0).toLong()
      endsAt = System.currentTimeMillis() + ms
    }
    main.post(tick)
    PlayerHub.emitSleep()
  }

  @MainThread
  fun cancel() {
    clear()
    PlayerHub.emitSleep()
  }

  /** Called when Media3 paused at the end of an item (only happens while `track` mode is armed). */
  @MainThread
  fun onPausedAtEndOfItem() {
    if (mode != "track") return
    clear()
    PlayerHub.emitSleep()
  }

  @MainThread
  private fun clear() {
    main.removeCallbacks(tick)
    if (mode == "track") PlayerHub.setPauseAtEndOfItem(false)
    mode = null
    endsAt = null
    PlayerHub.setFade(1f)
  }

  private val tick = object : Runnable {
    override fun run() {
      val m = mode ?: return
      val fadeMs = fadeSec * 1_000L
      val remaining = if (m == "time") (endsAt ?: 0L) - System.currentTimeMillis() else PlayerHub.remainingInItemMs()
      if (m == "time" && remaining <= 0L) {
        PlayerHub.pauseForSleep()
        clear()
        PlayerHub.emitSleep()
        return
      }
      if (fadeMs > 0L && remaining in 0L..fadeMs) {
        val x = remaining.toFloat() / fadeMs
        PlayerHub.setFade(x * x)
      } else {
        PlayerHub.setFade(1f)
      }
      val near = remaining in 0L..(fadeMs + 1_500L)
      main.postDelayed(this, if (near) 100L else 1_000L)
    }
  }
}
