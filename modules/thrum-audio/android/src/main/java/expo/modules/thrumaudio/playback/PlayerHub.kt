package expo.modules.thrumaudio.playback

import android.content.ComponentName
import android.content.Context
import android.content.SharedPreferences
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.MainThread
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.Player
import androidx.media3.common.Timeline
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.extractor.DefaultExtractorsFactory
import androidx.media3.extractor.mp3.Mp3Extractor
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/**
 * Owns the single ExoPlayer for the process. The JS module and [PlaybackService] (which wraps the
 * player in a MediaSession for the notification, lock screen, headsets and Bluetooth) share it.
 *
 * Every player call happens on the main thread. JS-thread reads go through a volatile snapshot, so
 * `getState`/`getPosition`/`getQueue` stay synchronous and never touch the player.
 */
@OptIn(UnstableApi::class)
object PlayerHub {
  interface Listener {
    fun onPlayback(state: Map<String, Any?>)
    fun onQueue(version: Int, index: Int, length: Int)
    fun onSleep(state: Map<String, Any?>)
    fun onError(message: String, code: String, trackId: String?)
  }

  private data class Snapshot(
    val status: String,
    val playing: Boolean,
    val playWhenReady: Boolean,
    val index: Int,
    val trackId: String?,
    val positionMs: Long,
    val durationMs: Long,
    val repeat: Int,
    val speed: Float,
    val pitch: Float,
    val skipSilence: Boolean,
    val queueVersion: Int,
    val queueLength: Int,
    val leveling: Boolean,
    val error: String?,
    val stampMs: Long,
  )

  private const val PREFS = "thrum_player"
  private const val TICK_MS = 1_000L
  private const val SAVE_POSITION_EVERY_MS = 10_000L
  private const val SAVE_QUEUE_DEBOUNCE_MS = 1_200L
  private const val MAX_ERROR_SKIPS = 5

  private lateinit var app: Context
  private lateinit var prefs: SharedPreferences
  private val main = Handler(Looper.getMainLooper())
  private var exo: ExoPlayer? = null
  private var controllerFuture: ListenableFuture<MediaController>? = null
  private val gains = ConcurrentHashMap<String, Double>()

  @Volatile var listener: Listener? = null
  @Volatile private var queue: List<QueueItem> = emptyList()
  @Volatile private var snapshot = Snapshot("idle", false, false, -1, null, 0L, 0L, Player.REPEAT_MODE_OFF, 1f, 1f, false, 0, 0, true, null, 0L)

  private var queueVersion = 0
  /** Set on any playlist change; an untouched (never restored) player must not overwrite the saved queue. */
  private var queueDirty = false
  private var leveling = true
  private var fade = 1f
  private var errorStreak = 0
  private var lastError: String? = null
  private var lastPositionSaveAt = 0L

  @Synchronized
  fun init(context: Context) {
    if (::app.isInitialized) return
    app = context.applicationContext
    prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    leveling = prefs.getBoolean("leveling", true)
    SessionStore.init(app)
    snapshot = snapshot.copy(
      repeat = prefs.getInt("repeat", Player.REPEAT_MODE_OFF),
      speed = prefs.getFloat("speed", 1f),
      pitch = prefs.getFloat("pitch", 1f),
      skipSilence = prefs.getBoolean("skipSilence", false),
      leveling = leveling,
    )
  }

  @MainThread
  fun player(context: Context): ExoPlayer {
    init(context)
    exo?.let { return it }
    val extractors = DefaultExtractorsFactory()
      .setConstantBitrateSeekingEnabled(true)
      // Exact MP3 seeking keeps synced lyrics aligned after a scrub (Xing tables are only ~1% accurate).
      .setMp3ExtractorFlags(Mp3Extractor.FLAG_ENABLE_INDEX_SEEKING)
    val attributes = AudioAttributes.Builder()
      .setUsage(C.USAGE_MEDIA)
      .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
      .build()
    val loadControl = DefaultLoadControl.Builder()
      .setBufferDurationsMs(10_000, 30_000, 500, 1_000)
      .build()
    val player = ExoPlayer.Builder(app, ThrumRenderersFactory(app))
      .setMediaSourceFactory(DefaultMediaSourceFactory(app, extractors))
      .setAudioAttributes(attributes, /* handleAudioFocus= */ true)
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_LOCAL)
      .setLoadControl(loadControl)
      .setSeekBackIncrementMs(10_000)
      .setSeekForwardIncrementMs(10_000)
      .build()
    player.repeatMode = prefs.getInt("repeat", Player.REPEAT_MODE_OFF)
    player.playbackParameters = PlaybackParameters(prefs.getFloat("speed", 1f), prefs.getFloat("pitch", 1f))
    player.skipSilenceEnabled = prefs.getBoolean("skipSilence", false)
    player.addListener(playerListener)
    exo = player
    refresh()
    return player
  }

  private fun requirePlayer(): ExoPlayer = player(app)

  // region service + controller

  /** Binds [PlaybackService] (through a MediaController) so the session exists while the UI is alive. */
  @MainThread
  fun connect() {
    if (controllerFuture != null || !::app.isInitialized) return
    val token = SessionToken(app, ComponentName(app, PlaybackService::class.java))
    controllerFuture = MediaController.Builder(app, token).buildAsync()
  }

  @MainThread
  fun disconnect() {
    controllerFuture?.let { MediaController.releaseFuture(it) }
    controllerFuture = null
  }

  @MainThread
  fun onServiceDestroyed() {
    if (listener != null) {
      // The UI is still alive: bind again so the next play gets a notification.
      disconnect()
      main.post { connect() }
    } else {
      releasePlayer()
    }
  }

  @MainThread
  fun releasePlayer() {
    val player = exo ?: return
    persistNow()
    main.removeCallbacks(ticker)
    player.removeListener(playerListener)
    player.release()
    exo = null
    LatencyTrackingSink.current = null
    queue = emptyList()
    refresh()
  }

  /** Writes queue + position immediately (task removed, service destroyed, app backgrounded). */
  @MainThread
  fun persistNow() {
    main.removeCallbacks(saveQueue)
    if (exo != null) saveQueue.run()
  }

  // endregion

  // region queue

  @MainThread
  fun setQueue(items: List<QueueItem>, startIndex: Int, startPositionMs: Long, playWhenReady: Boolean) {
    val player = requirePlayer()
    rememberGains(items)
    lastError = null
    errorStreak = 0
    if (items.isEmpty()) {
      player.stop()
      player.clearMediaItems()
      return
    }
    val index = startIndex.coerceIn(0, items.size - 1)
    player.setMediaItems(items.map { it.toMediaItem() }, index, max(0L, startPositionMs))
    player.prepare()
    player.playWhenReady = playWhenReady
    applyVolume()
  }

  /** Swaps everything around the playing item, so a reshuffle never interrupts the music. */
  @MainThread
  fun reorderQueue(items: List<QueueItem>, currentIndex: Int) {
    val player = requirePlayer()
    rememberGains(items)
    val current = player.currentMediaItem
    if (current == null || currentIndex !in items.indices || items[currentIndex].id != current.mediaId) {
      val index = currentIndex.coerceIn(0, max(0, items.size - 1))
      val keepPosition = current != null && items.getOrNull(index)?.id == current.mediaId
      val wasPrepared = player.playbackState != Player.STATE_IDLE
      if (items.isEmpty()) {
        player.clearMediaItems()
        return
      }
      player.setMediaItems(items.map { it.toMediaItem() }, index, if (keepPosition) player.currentPosition else 0L)
      if (wasPrepared) player.prepare()
      return
    }
    val playingIndex = player.currentMediaItemIndex
    val count = player.mediaItemCount
    if (playingIndex + 1 < count) player.removeMediaItems(playingIndex + 1, count)
    if (playingIndex > 0) player.removeMediaItems(0, playingIndex)
    val after = items.subList(currentIndex + 1, items.size).map { it.toMediaItem() }
    val before = items.subList(0, currentIndex).map { it.toMediaItem() }
    if (after.isNotEmpty()) player.addMediaItems(1, after)
    if (before.isNotEmpty()) player.addMediaItems(0, before)
  }

  @MainThread
  fun addItems(items: List<QueueItem>, atIndex: Int) {
    if (items.isEmpty()) return
    val player = requirePlayer()
    rememberGains(items)
    val index = if (atIndex < 0) player.mediaItemCount else atIndex.coerceIn(0, player.mediaItemCount)
    player.addMediaItems(index, items.map { it.toMediaItem() })
  }

  @MainThread
  fun removeItem(index: Int) {
    val player = requirePlayer()
    if (index in 0 until player.mediaItemCount) player.removeMediaItem(index)
  }

  @MainThread
  fun moveItem(from: Int, to: Int) {
    val player = requirePlayer()
    val count = player.mediaItemCount
    if (from !in 0 until count) return
    player.moveMediaItem(from, to.coerceIn(0, count - 1))
  }

  fun queueMaps(): List<Map<String, Any?>> = queue.map { it.toMap(gains[it.id]) }

  private fun rememberGains(items: List<QueueItem>) {
    for (item in items) rememberGain(item)
  }

  fun rememberGain(item: QueueItem) {
    item.gainDb?.let { gains[item.id] = it.coerceIn(-24.0, 0.0) }
  }

  // endregion

  // region transport

  @MainThread
  fun play() {
    val player = requirePlayer()
    if (player.mediaItemCount == 0) return
    Util.handlePlayButtonAction(player)
  }

  @MainThread
  fun pause() {
    exo?.let { Util.handlePauseButtonAction(it) }
  }

  @MainThread
  fun togglePlay() {
    val player = requirePlayer()
    if (player.mediaItemCount == 0) return
    Util.handlePlayPauseButtonAction(player)
  }

  @MainThread
  fun seekTo(positionMs: Long) {
    val player = exo ?: return
    if (player.mediaItemCount == 0) return
    player.seekTo(max(0L, positionMs))
    savePositionNow()
  }

  @MainThread
  fun next() {
    val player = exo ?: return
    if (player.mediaItemCount == 0) return
    if (player.hasNextMediaItem()) {
      player.seekToNextMediaItem()
    } else {
      player.seekTo(0, 0L)
      player.pause()
    }
  }

  @MainThread
  fun previous() {
    val player = exo ?: return
    if (player.mediaItemCount == 0) return
    player.seekToPrevious()
  }

  @MainThread
  fun skipTo(index: Int, positionMs: Long) {
    val player = exo ?: return
    if (index !in 0 until player.mediaItemCount) return
    player.seekTo(index, max(0L, positionMs))
  }

  @MainThread
  fun stop() {
    val player = exo ?: return
    savePositionNow()
    player.stop()
  }

  // endregion

  // region settings

  @MainThread
  fun setRepeatMode(mode: String) {
    val value = when (mode) {
      "all" -> Player.REPEAT_MODE_ALL
      "one" -> Player.REPEAT_MODE_ONE
      else -> Player.REPEAT_MODE_OFF
    }
    requirePlayer().repeatMode = value
    prefs.edit().putInt("repeat", value).apply()
  }

  @MainThread
  fun setSpeed(speed: Float, pitch: Float) {
    val s = if (speed.isFinite()) speed.coerceIn(0.25f, 3f) else 1f
    val p = if (pitch.isFinite()) pitch.coerceIn(0.5f, 2f) else 1f
    requirePlayer().playbackParameters = PlaybackParameters(s, p)
    prefs.edit().putFloat("speed", s).putFloat("pitch", p).apply()
  }

  @MainThread
  fun setSkipSilence(enabled: Boolean) {
    requirePlayer().skipSilenceEnabled = enabled
    prefs.edit().putBoolean("skipSilence", enabled).apply()
    refresh()
    emitPlayback()
  }

  @MainThread
  fun setLeveling(enabled: Boolean) {
    leveling = enabled
    prefs.edit().putBoolean("leveling", enabled).apply()
    applyVolume()
    refresh()
    emitPlayback()
  }

  @MainThread
  fun setItemGain(id: String, gainDb: Double?) {
    if (gainDb == null || !gainDb.isFinite()) gains.remove(id) else gains[id] = gainDb.coerceIn(-24.0, 0.0)
    if (exo?.currentMediaItem?.mediaId == id) applyVolume()
    if (queue.any { it.id == id }) {
      queueDirty = true
      scheduleQueueSave()
    }
  }

  // endregion

  // region sleep timer hooks

  @MainThread
  fun setFade(value: Float) {
    if (fade == value) return
    fade = value.coerceIn(0f, 1f)
    applyVolume()
  }

  @MainThread
  fun pauseForSleep() {
    exo?.pause()
  }

  @MainThread
  fun setPauseAtEndOfItem(enabled: Boolean) {
    exo?.pauseAtEndOfMediaItems = enabled
  }

  @MainThread
  fun remainingInItemMs(): Long {
    val player = exo ?: return Long.MAX_VALUE
    val duration = player.duration
    if (duration == C.TIME_UNSET) return Long.MAX_VALUE
    val speed = player.playbackParameters.speed.takeIf { it > 0f } ?: 1f
    return ((duration - player.currentPosition) / speed).toLong()
  }

  fun emitSleep() {
    listener?.onSleep(SleepTimer.state())
  }

  // endregion

  // region session restore

  fun hasItems(): Boolean = snapshot.queueLength > 0

  /** Loads a saved session into an idle player without preparing it (no notification until play). */
  @MainThread
  fun restore(saved: SessionStore.Saved): Boolean {
    val player = requirePlayer()
    if (player.mediaItemCount > 0) return true
    rememberGains(saved.items)
    player.setMediaItems(saved.items.map { it.toMediaItem() }, saved.index, saved.positionMs)
    applyVolume()
    return true
  }

  // endregion

  // region state

  fun state(): Map<String, Any?> {
    val s = snapshot
    return mapOf(
      "status" to s.status,
      "playing" to s.playing,
      "playWhenReady" to s.playWhenReady,
      "index" to s.index,
      "trackId" to s.trackId,
      "positionMs" to position().toDouble(),
      "durationMs" to s.durationMs.toDouble(),
      "repeat" to when (s.repeat) {
        Player.REPEAT_MODE_ALL -> "all"
        Player.REPEAT_MODE_ONE -> "one"
        else -> "off"
      },
      "speed" to s.speed.toDouble(),
      "pitch" to s.pitch.toDouble(),
      "skipSilence" to s.skipSilence,
      "queueVersion" to s.queueVersion,
      "queueLength" to s.queueLength,
      "leveling" to s.leveling,
      "error" to s.error,
    )
  }

  /** Position extrapolated from the last snapshot; safe from any thread. */
  fun position(): Long {
    val s = snapshot
    if (!s.playing) return s.positionMs
    val elapsed = SystemClock.elapsedRealtime() - s.stampMs
    val position = s.positionMs + (elapsed * s.speed).toLong()
    return if (s.durationMs > 0) min(position, s.durationMs) else position
  }

  @MainThread
  private fun refresh() {
    val player = exo
    if (player == null) {
      snapshot = snapshot.copy(
        status = "idle", playing = false, playWhenReady = false, index = -1, trackId = null,
        positionMs = 0L, durationMs = 0L, queueLength = 0, queueVersion = queueVersion,
        leveling = leveling, error = lastError, stampMs = SystemClock.elapsedRealtime(),
      )
      return
    }
    val count = player.mediaItemCount
    val index = if (count == 0) -1 else player.currentMediaItemIndex
    val duration = player.duration.takeIf { it != C.TIME_UNSET }
      ?: queue.getOrNull(index)?.durationMs ?: 0L
    snapshot = Snapshot(
      status = when (player.playbackState) {
        Player.STATE_BUFFERING -> "buffering"
        Player.STATE_READY -> "ready"
        Player.STATE_ENDED -> "ended"
        else -> "idle"
      },
      playing = player.isPlaying,
      playWhenReady = player.playWhenReady,
      index = index,
      trackId = player.currentMediaItem?.mediaId,
      positionMs = max(0L, player.currentPosition),
      durationMs = max(0L, duration),
      repeat = player.repeatMode,
      speed = player.playbackParameters.speed,
      pitch = player.playbackParameters.pitch,
      skipSilence = player.skipSilenceEnabled,
      queueVersion = queueVersion,
      queueLength = count,
      leveling = leveling,
      error = lastError,
      stampMs = SystemClock.elapsedRealtime(),
    )
  }

  private fun emitPlayback() {
    listener?.onPlayback(state())
  }

  @MainThread
  private fun applyVolume() {
    val player = exo ?: return
    val id = player.currentMediaItem?.mediaId
    val gain = if (leveling && id != null) gains[id] ?: 0.0 else 0.0
    val linear = 10.0.pow(gain.coerceIn(-24.0, 0.0) / 20.0).toFloat()
    player.volume = (linear * fade).coerceIn(0f, 1f)
  }

  // endregion

  // region listener + housekeeping

  private val playerListener = object : Player.Listener {
    override fun onEvents(player: Player, events: Player.Events) {
      if (events.containsAny(
          Player.EVENT_PLAYBACK_STATE_CHANGED,
          Player.EVENT_PLAY_WHEN_READY_CHANGED,
          Player.EVENT_IS_PLAYING_CHANGED,
          Player.EVENT_MEDIA_ITEM_TRANSITION,
          Player.EVENT_POSITION_DISCONTINUITY,
          Player.EVENT_TIMELINE_CHANGED,
          Player.EVENT_REPEAT_MODE_CHANGED,
          Player.EVENT_PLAYBACK_PARAMETERS_CHANGED,
          Player.EVENT_PLAYER_ERROR,
        )
      ) {
        refresh()
        emitPlayback()
      }
    }

    override fun onTimelineChanged(timeline: Timeline, reason: Int) {
      if (reason == Player.TIMELINE_CHANGE_REASON_PLAYLIST_CHANGED) rebuildQueue()
    }

    override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
      applyVolume()
      savePositionNow()
    }

    override fun onIsPlayingChanged(isPlaying: Boolean) {
      if (isPlaying) {
        errorStreak = 0
        lastError = null
        main.removeCallbacks(ticker)
        main.postDelayed(ticker, TICK_MS)
      } else {
        main.removeCallbacks(ticker)
        savePositionNow()
      }
    }

    override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
      if (reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) SleepTimer.onPausedAtEndOfItem()
    }

    override fun onPlayerError(error: PlaybackException) {
      val player = exo ?: return
      val message = error.message ?: error.errorCodeName
      lastError = message
      listener?.onError(message, error.errorCodeName, player.currentMediaItem?.mediaId)
      // Skip unplayable or deleted files instead of stalling the whole queue.
      if (errorStreak < MAX_ERROR_SKIPS && player.mediaItemCount > 1 && player.hasNextMediaItem()) {
        errorStreak++
        player.seekToNextMediaItem()
        player.prepare()
      }
    }
  }

  @MainThread
  private fun rebuildQueue() {
    val player = exo ?: return
    val count = player.mediaItemCount
    val items = ArrayList<QueueItem>(count)
    for (i in 0 until count) items.add(QueueItem.fromMediaItem(player.getMediaItemAt(i)))
    queue = items
    queueVersion++
    queueDirty = true
    refresh()
    main.removeCallbacks(queueEvent)
    main.post(queueEvent)
    scheduleQueueSave()
  }

  private val queueEvent = Runnable {
    val s = snapshot
    listener?.onQueue(s.queueVersion, s.index, s.queueLength)
  }

  private fun scheduleQueueSave() {
    main.removeCallbacks(saveQueue)
    main.postDelayed(saveQueue, SAVE_QUEUE_DEBOUNCE_MS)
  }

  private val saveQueue = Runnable {
    if (queueDirty) {
      queueDirty = false
      SessionStore.writeQueueAsync(queue.map { it.copy(gainDb = gains[it.id]) })
    }
    savePositionNow()
  }

  @MainThread
  private fun savePositionNow() {
    val player = exo ?: return
    if (player.mediaItemCount == 0) return
    lastPositionSaveAt = SystemClock.elapsedRealtime()
    SessionStore.savePosition(player.currentMediaItemIndex, player.currentMediaItem?.mediaId, player.currentPosition)
  }

  private val ticker = object : Runnable {
    override fun run() {
      val player = exo ?: return
      if (!player.isPlaying) return
      refresh()
      if (SystemClock.elapsedRealtime() - lastPositionSaveAt >= SAVE_POSITION_EVERY_MS) savePositionNow()
      main.postDelayed(this, TICK_MS)
    }
  }

  // endregion
}
