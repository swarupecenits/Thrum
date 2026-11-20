package expo.modules.thrumaudio.library

import android.content.Context
import android.database.ContentObserver
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore

/** Fires (debounced) when MediaStore audio changes: downloads, deletions, SD card mounts. */
class LibraryObserver(private val context: Context, private val onChange: () -> Unit) {
  private val handler = Handler(Looper.getMainLooper())
  private val fire = Runnable { onChange() }
  private var registered = false

  private val observer = object : ContentObserver(handler) {
    override fun onChange(selfChange: Boolean) {
      handler.removeCallbacks(fire)
      handler.postDelayed(fire, DEBOUNCE_MS)
    }
  }

  fun register() {
    if (registered) return
    registered = runCatching {
      context.contentResolver.registerContentObserver(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, true, observer)
    }.isSuccess
  }

  fun unregister() {
    handler.removeCallbacks(fire)
    if (!registered) return
    runCatching { context.contentResolver.unregisterContentObserver(observer) }
    registered = false
  }

  private companion object {
    const val DEBOUNCE_MS = 2_000L
  }
}
