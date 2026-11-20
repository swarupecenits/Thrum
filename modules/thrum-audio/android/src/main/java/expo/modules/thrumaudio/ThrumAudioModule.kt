package expo.modules.thrumaudio

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import expo.modules.interfaces.permissions.Permissions
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.thrumaudio.dsp.DspEngine
import expo.modules.thrumaudio.library.ArtworkCache
import expo.modules.thrumaudio.library.LibraryObserver
import expo.modules.thrumaudio.library.MediaScanner
import expo.modules.thrumaudio.playback.LatencyTrackingSink
import expo.modules.thrumaudio.playback.PlayerHub
import expo.modules.thrumaudio.playback.QueueItem
import expo.modules.thrumaudio.playback.SessionStore
import expo.modules.thrumaudio.playback.SleepTimer
import expo.modules.thrumaudio.sound.SoundCenter
import expo.modules.thrumaudio.tags.TagReader
import expo.modules.thrumaudio.work.AnalysisQueue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

class ThrumAudioModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  private val main = Handler(Looper.getMainLooper())
  private val artDispatcher = Dispatchers.IO.limitedParallelism(3)
  private var observer: LibraryObserver? = null

  private val hubListener = object : PlayerHub.Listener {
    override fun onPlayback(state: Map<String, Any?>) = sendEvent("onPlayback", state)

    override fun onQueue(version: Int, index: Int, length: Int) =
      sendEvent("onQueue", mapOf("version" to version, "index" to index, "length" to length))

    override fun onSleep(state: Map<String, Any?>) = sendEvent("onSleep", state)

    override fun onError(message: String, code: String, trackId: String?) =
      sendEvent("onError", mapOf("message" to message, "code" to code, "trackId" to trackId))
  }

  private val routeListener: (Map<String, Any?>, Map<String, Any?>) -> Unit = { route, sound ->
    sendEvent("onRoute", mapOf("route" to route, "sound" to sound))
  }

  private val analysisListener: (Map<String, Any?>) -> Unit = { event -> sendEvent("onAnalysis", event) }

  private fun audioPermission(): String =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      android.Manifest.permission.READ_MEDIA_AUDIO
    } else {
      android.Manifest.permission.READ_EXTERNAL_STORAGE
    }

  private fun items(raw: List<Map<String, Any?>>): List<QueueItem> = raw.mapNotNull(QueueItem::fromMap)

  override fun definition() = ModuleDefinition {
    Name("ThrumAudio")

    Events("onPlayback", "onQueue", "onRoute", "onSleep", "onLibraryChanged", "onAnalysis", "onError")

    OnCreate {
      val ctx = context
      PlayerHub.init(ctx)
      SoundCenter.init(ctx)
      PlayerHub.listener = hubListener
      SoundCenter.listener = routeListener
      AnalysisQueue.listener = analysisListener
      main.post { PlayerHub.connect() }
      observer = LibraryObserver(ctx) { sendEvent("onLibraryChanged", emptyMap<String, Any?>()) }.also { it.register() }
    }

    OnDestroy {
      // Only detach our own listeners: during a reload the next module instance may already be live.
      if (PlayerHub.listener === hubListener) PlayerHub.listener = null
      if (SoundCenter.listener === routeListener) SoundCenter.listener = null
      if (AnalysisQueue.listener === analysisListener) AnalysisQueue.listener = null
      observer?.unregister()
      observer = null
      main.post {
        PlayerHub.persistNow()
        if (PlayerHub.listener == null) PlayerHub.disconnect()
      }
    }

    // region permissions + library

    AsyncFunction("getPermissionStatus") { promise: Promise ->
      Permissions.getPermissionsWithPermissionsManager(appContext.permissions, promise, audioPermission())
    }

    AsyncFunction("requestPermission") { promise: Promise ->
      Permissions.askForPermissionsWithPermissionsManager(appContext.permissions, promise, audioPermission())
    }

    AsyncFunction("scanLibrary") Coroutine { options: Map<String, Any?> ->
      val minDuration = (options["minDurationMs"] as? Number)?.toLong() ?: 30_000L
      val excluded = (options["excludedFolders"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
      val ctx = context
      withContext(Dispatchers.IO) { MediaScanner.scan(ctx, minDuration, excluded) }
    }

    AsyncFunction("getArtwork") Coroutine { albumId: String, trackId: String, size: String ->
      val ctx = context
      withContext(artDispatcher) { ArtworkCache.get(ctx, albumId, trackId, size) }
    }

    AsyncFunction("clearArtworkCache") Coroutine { ->
      val ctx = context
      withContext(Dispatchers.IO) { ArtworkCache.clear(ctx) }
    }

    // endregion

    // region queue + transport (player lives on the main thread)

    AsyncFunction("setQueue") { raw: List<Map<String, Any?>>, startIndex: Int, startPositionMs: Double, playWhenReady: Boolean ->
      PlayerHub.setQueue(items(raw), startIndex, startPositionMs.toLong(), playWhenReady)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("reorderQueue") { raw: List<Map<String, Any?>>, currentIndex: Int ->
      PlayerHub.reorderQueue(items(raw), currentIndex)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("addItems") { raw: List<Map<String, Any?>>, atIndex: Int ->
      PlayerHub.addItems(items(raw), atIndex)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("removeItem") { index: Int -> PlayerHub.removeItem(index) }.runOnQueue(Queues.MAIN)

    AsyncFunction("moveItem") { from: Int, to: Int -> PlayerHub.moveItem(from, to) }.runOnQueue(Queues.MAIN)

    AsyncFunction("play") { PlayerHub.play() }.runOnQueue(Queues.MAIN)

    AsyncFunction("pause") { PlayerHub.pause() }.runOnQueue(Queues.MAIN)

    AsyncFunction("togglePlay") { PlayerHub.togglePlay() }.runOnQueue(Queues.MAIN)

    AsyncFunction("seekTo") { positionMs: Double -> PlayerHub.seekTo(positionMs.toLong()) }.runOnQueue(Queues.MAIN)

    AsyncFunction("next") { PlayerHub.next() }.runOnQueue(Queues.MAIN)

    AsyncFunction("previous") { PlayerHub.previous() }.runOnQueue(Queues.MAIN)

    AsyncFunction("skipTo") { index: Int, positionMs: Double ->
      PlayerHub.skipTo(index, positionMs.toLong())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setRepeatMode") { mode: String -> PlayerHub.setRepeatMode(mode) }.runOnQueue(Queues.MAIN)

    AsyncFunction("setSpeed") { speed: Double, pitch: Double ->
      PlayerHub.setSpeed(speed.toFloat(), pitch.toFloat())
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setSkipSilence") { enabled: Boolean -> PlayerHub.setSkipSilence(enabled) }.runOnQueue(Queues.MAIN)

    AsyncFunction("setLeveling") { enabled: Boolean -> PlayerHub.setLeveling(enabled) }.runOnQueue(Queues.MAIN)

    AsyncFunction("setItemGain") { id: String, gainDb: Double? -> PlayerHub.setItemGain(id, gainDb) }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { PlayerHub.stop() }.runOnQueue(Queues.MAIN)

    Function("getState") { PlayerHub.state() }

    Function("getPosition") { PlayerHub.position().toDouble() }

    Function("getQueue") { PlayerHub.queueMaps() }

    AsyncFunction("restoreSession") Coroutine { ->
      if (PlayerHub.hasItems()) {
        true
      } else {
        val saved = withContext(Dispatchers.IO) { SessionStore.load() }
        if (saved == null) false else withContext(Dispatchers.Main) { PlayerHub.restore(saved) }
      }
    }

    // endregion

    // region sleep timer

    AsyncFunction("setSleepTimer") { minutes: Double, mode: String, fadeSec: Int ->
      SleepTimer.set(minutes, mode, fadeSec)
      SleepTimer.state()
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("cancelSleepTimer") {
      SleepTimer.cancel()
      SleepTimer.state()
    }.runOnQueue(Queues.MAIN)

    Function("getSleepTimer") { SleepTimer.state() }

    // endregion

    // region sound

    Function("getSoundState") { SoundCenter.state() }

    Function("setSound") { params: Map<String, Any?> -> SoundCenter.setSound(params) }

    Function("setPerDevice") { enabled: Boolean -> SoundCenter.setPerDevice(enabled) }

    Function("setBypass") { bypass: Boolean -> SoundCenter.setBypass(bypass) }

    Function("getSpectrum") {
      val sink = LatencyTrackingSink.current
      val delayFrames = if (sink == null) 0L else sink.latencyUs() * sink.sampleRate() / 1_000_000L
      DspEngine.readSpectrum(delayFrames.toInt(), System.nanoTime())?.toMap()
    }

    // endregion

    // region analysis + tags

    AsyncFunction("analyze") { raw: List<Map<String, Any?>> ->
      val list = raw.mapNotNull { m ->
        val id = m["id"] as? String ?: return@mapNotNull null
        id to ((m["durationMs"] as? Number)?.toLong() ?: 0L)
      }
      AnalysisQueue.enqueue(context, list)
    }

    Function("cancelAnalysis") { AnalysisQueue.cancel() }

    AsyncFunction("readTags") Coroutine { id: String ->
      val ctx = context
      withContext(Dispatchers.IO) { TagReader.read(ctx, QueueItem.contentUri(id), mimeOf(ctx, id)) }
    }

    // endregion
  }

  private fun mimeOf(ctx: Context, id: String): String? = runCatching {
    ctx.contentResolver.query(
      QueueItem.contentUri(id),
      arrayOf(MediaStore.Audio.Media.MIME_TYPE),
      null, null, null,
    )?.use { c -> if (c.moveToFirst()) c.getString(0) else null }
  }.getOrNull()
}
