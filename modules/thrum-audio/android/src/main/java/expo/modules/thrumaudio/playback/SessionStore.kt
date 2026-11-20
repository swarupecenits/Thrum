package expo.modules.thrumaudio.playback

import android.content.Context
import android.content.SharedPreferences
import android.util.AtomicFile
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Persists the last queue (JSON file written off the main thread) and the play position
 * (SharedPreferences), so the app reopens exactly where it was and the system can resume playback
 * from the notification or a headset button after a reboot.
 */
object SessionStore {
  data class Saved(val items: List<QueueItem>, val index: Int, val positionMs: Long)

  private const val QUEUE_FILE = "queue.json"

  private lateinit var dir: File
  private lateinit var prefs: SharedPreferences
  private val io: ExecutorService = Executors.newSingleThreadExecutor { r ->
    Thread(r, "thrum-session").apply { isDaemon = true }
  }

  @Synchronized
  fun init(context: Context) {
    if (::prefs.isInitialized) return
    prefs = context.getSharedPreferences("thrum_session", Context.MODE_PRIVATE)
    dir = File(context.filesDir, "thrum").apply { mkdirs() }
  }

  /** [items] must already carry their current gain. Serialization happens on the IO thread. */
  fun writeQueueAsync(items: List<QueueItem>) {
    if (!::dir.isInitialized) return
    io.execute { writeQueue(items) }
  }

  fun savePosition(index: Int, trackId: String?, positionMs: Long) {
    if (!::prefs.isInitialized) return
    prefs.edit()
      .putInt("index", index)
      .putString("trackId", trackId)
      .putLong("positionMs", positionMs.coerceAtLeast(0L))
      .putLong("savedAt", System.currentTimeMillis())
      .apply()
  }

  /** Blocking file read; call off the main thread when possible. */
  fun load(): Saved? {
    if (!::dir.isInitialized) return null
    val file = File(dir, QUEUE_FILE)
    if (!file.exists()) return null
    val items = try {
      val root = JSONObject(AtomicFile(file).readFully().toString(Charsets.UTF_8))
      val array = root.optJSONArray("items") ?: return null
      (0 until array.length()).mapNotNull { QueueItem.fromJson(array.optJSONObject(it)) }
    } catch (e: Exception) {
      return null
    }
    if (items.isEmpty()) return null
    var index = prefs.getInt("index", 0).coerceIn(0, items.size - 1)
    val trackId = prefs.getString("trackId", null)
    if (trackId != null && items[index].id != trackId) {
      val found = items.indexOfFirst { it.id == trackId }
      if (found >= 0) index = found
    }
    val position = if (items[index].id == trackId) prefs.getLong("positionMs", 0L) else 0L
    return Saved(items, index, position.coerceAtLeast(0L))
  }

  private fun writeQueue(items: List<QueueItem>) {
    val array = JSONArray()
    for (item in items) array.put(item.toJson(item.gainDb))
    val bytes = JSONObject().put("v", 1).put("items", array).toString().toByteArray(Charsets.UTF_8)
    val atomic = AtomicFile(File(dir, QUEUE_FILE))
    var stream: FileOutputStream? = null
    try {
      stream = atomic.startWrite()
      stream.write(bytes)
      atomic.finishWrite(stream)
    } catch (e: Exception) {
      if (stream != null) atomic.failWrite(stream)
    }
  }
}
