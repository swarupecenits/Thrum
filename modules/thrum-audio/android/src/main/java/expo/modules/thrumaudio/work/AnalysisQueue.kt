package expo.modules.thrumaudio.work

import android.content.Context
import android.os.Process
import expo.modules.thrumaudio.analysis.TrackAnalyzer
import expo.modules.thrumaudio.playback.QueueItem

/**
 * Background audio analysis (tempo, energy, bass, mood features) for vibe search. One low-priority
 * worker thread; newest requests are appended, duplicates collapse, cancel drops everything queued
 * and stops the track being decoded.
 */
object AnalysisQueue {
  private val lock = Object()
  private val pending = LinkedHashMap<String, Long>()
  private var worker: Thread? = null
  private lateinit var app: Context
  @Volatile private var generation = 0

  /** Receives `AnalysisEvent` maps. */
  @Volatile var listener: ((Map<String, Any?>) -> Unit)? = null

  fun enqueue(context: Context, items: List<Pair<String, Long>>) {
    synchronized(lock) {
      app = context.applicationContext
      for ((id, durationMs) in items) {
        if (id.toLongOrNull() != null) pending[id] = durationMs
      }
      if (worker == null && pending.isNotEmpty()) {
        worker = Thread(::loop, "thrum-analysis").apply {
          isDaemon = true
          start()
        }
      }
    }
  }

  fun cancel() {
    synchronized(lock) {
      pending.clear()
      generation++
    }
  }

  private fun loop() {
    Process.setThreadPriority(Process.THREAD_PRIORITY_BACKGROUND)
    while (true) {
      val id: String
      val durationMs: Long
      val gen: Int
      val remaining: Int
      synchronized(lock) {
        val next = pending.entries.firstOrNull()
        if (next == null) {
          worker = null
          return
        }
        pending.remove(next.key)
        id = next.key
        durationMs = next.value
        gen = generation
        remaining = pending.size
      }
      try {
        val features = TrackAnalyzer(app).analyze(QueueItem.contentUri(id), durationMs) { generation != gen }
        if (generation != gen) continue
        emit(id, features?.toMap(), if (features == null) "unsupported" else null, remaining)
      } catch (e: Throwable) {
        if (generation != gen) continue
        emit(id, null, e.message ?: e.javaClass.simpleName, remaining)
      }
    }
  }

  private fun emit(id: String, features: Map<String, Any?>?, error: String?, remaining: Int) {
    listener?.invoke(mapOf("id" to id, "features" to features, "error" to error, "remaining" to remaining))
  }
}
