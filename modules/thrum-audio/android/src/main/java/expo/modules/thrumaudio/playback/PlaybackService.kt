package expo.modules.thrumaudio.playback

import android.app.PendingIntent
import android.content.Intent
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.SettableFuture
import expo.modules.thrumaudio.library.ArtworkCache
import expo.modules.thrumaudio.sound.SoundCenter
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Hosts the MediaSession around [PlayerHub]'s player: media notification, lock screen, Now Bar,
 * Bluetooth/headset buttons and System UI playback resumption after a reboot.
 *
 * It's a library service only because System UI fetches the resumption card through the library
 * "recent" root, which Media3 serves for library sessions alone. The browsable tree stays empty.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaLibraryService() {
  private var session: MediaLibrarySession? = null
  private val background: ExecutorService = Executors.newSingleThreadExecutor { r ->
    Thread(r, "thrum-resume").apply { isDaemon = true }
  }

  override fun onCreate() {
    super.onCreate()
    SoundCenter.init(this)
    setShowNotificationForIdlePlayer(SHOW_NOTIFICATION_FOR_IDLE_PLAYER_NEVER)
    val builder = MediaLibrarySession.Builder(this, PlayerHub.player(this), callback)
      .setId("thrum")
      .setBitmapLoader(ThrumBitmapLoader(this))
    sessionActivity()?.let { builder.setSessionActivity(it) }
    session = builder.build()
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

  override fun onTaskRemoved(rootIntent: Intent?) {
    PlayerHub.persistNow()
    super.onTaskRemoved(rootIntent)
  }

  override fun onDestroy() {
    PlayerHub.persistNow()
    session?.release()
    session = null
    background.shutdown()
    PlayerHub.onServiceDestroyed()
    super.onDestroy()
  }

  /** Tapping the notification opens Now Playing (expo-router deep link). */
  private fun sessionActivity(): PendingIntent? {
    val intent = Intent(Intent.ACTION_VIEW, Uri.parse("thrum://now-playing"))
      .setPackage(packageName)
      .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (intent.resolveActivity(packageManager) == null) {
      val launch = packageManager.getLaunchIntentForPackage(packageName) ?: return null
      return PendingIntent.getActivity(this, 0, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }
    return PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  private val callback = object : MediaLibrarySession.Callback {
    // Without a root, legacy browsers (which only connect to reach the session) would be refused.
    override fun onGetLibraryRoot(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<MediaItem>> = Futures.immediateFuture(LibraryResult.ofItem(ROOT, params))

    override fun onGetItem(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      mediaId: String,
    ): ListenableFuture<LibraryResult<MediaItem>> = Futures.immediateFuture(
      if (mediaId == ROOT_ID) LibraryResult.ofItem(ROOT, null) else LibraryResult.ofError(SessionError.ERROR_BAD_VALUE),
    )

    override fun onGetChildren(
      session: MediaLibrarySession,
      browser: MediaSession.ControllerInfo,
      parentId: String,
      page: Int,
      pageSize: Int,
      params: LibraryParams?,
    ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> = Futures.immediateFuture(
      if (parentId == ROOT_ID) {
        LibraryResult.ofItemList(ImmutableList.of(), params)
      } else {
        LibraryResult.ofError(SessionError.ERROR_BAD_VALUE)
      },
    )

    /**
     * External controllers (Assistant, Wear, car) only get to queue MediaStore audio by id. Any URI
     * they pass is ignored, so another app can never make Thrum open a file on its behalf.
     */
    override fun onAddMediaItems(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      mediaItems: MutableList<MediaItem>,
    ): ListenableFuture<MutableList<MediaItem>> {
      val resolved = mediaItems.mapNotNullTo(ArrayList()) { item ->
        val id = item.mediaId
        if (id.toLongOrNull() == null) return@mapNotNullTo null
        val metadata = item.mediaMetadata.buildUpon()
          .setArtworkUri(QueueItem.artUri("", id))
          .setArtworkData(null, null)
          .build()
        MediaItem.Builder()
          .setMediaId(id)
          .setUri(QueueItem.contentUri(id))
          .setMediaMetadata(metadata)
          .build()
      }
      return Futures.immediateFuture(resolved)
    }

    override fun onPlaybackResumption(
      mediaSession: MediaSession,
      controller: MediaSession.ControllerInfo,
      isForPlayback: Boolean,
    ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> {
      val future = SettableFuture.create<MediaSession.MediaItemsWithStartPosition>()
      background.execute {
        try {
          val saved = SessionStore.load()
          if (saved == null) {
            future.setException(UnsupportedOperationException("Nothing to resume"))
            return@execute
          }
          saved.items.forEach { PlayerHub.rememberGain(it) }
          if (isForPlayback) {
            future.set(
              MediaSession.MediaItemsWithStartPosition(saved.items.map { it.toMediaItem() }, saved.index, saved.positionMs),
            )
          } else {
            // System UI renders the resumption card itself and can't read our art URIs: embed the bytes.
            val current = saved.items[saved.index]
            val item = current.toMediaItem()
            val art = ArtworkCache.resumptionJpeg(this@PlaybackService, current.albumId, current.id)
            val metadata = item.mediaMetadata.buildUpon().apply {
              if (art != null) {
                setArtworkData(art, MediaMetadata.PICTURE_TYPE_FRONT_COVER)
                setArtworkUri(null)
              }
            }.build()
            future.set(
              MediaSession.MediaItemsWithStartPosition(
                listOf(item.buildUpon().setMediaMetadata(metadata).build()),
                0,
                saved.positionMs,
              ),
            )
          }
        } catch (e: Exception) {
          future.setException(e)
        }
      }
      return future
    }
  }

  private companion object {
    const val ROOT_ID = "thrum.root"
    val ROOT: MediaItem = MediaItem.Builder()
      .setMediaId(ROOT_ID)
      .setMediaMetadata(
        MediaMetadata.Builder()
          .setTitle("Thrum")
          .setIsBrowsable(true)
          .setIsPlayable(false)
          .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
          .build(),
      )
      .build()
  }
}
