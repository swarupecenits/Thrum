package expo.modules.thrumaudio.playback

import android.content.ContentUris
import android.net.Uri
import android.os.Bundle
import android.provider.MediaStore
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import org.json.JSONObject

/** One entry of the native play queue. Mirrors `QueueItem` in ThrumAudio.types.ts. */
data class QueueItem(
  val id: String,
  val title: String,
  val artist: String,
  val album: String,
  val albumId: String,
  val durationMs: Long,
  val artworkUri: String?,
  val gainDb: Double?,
) {
  fun toMediaItem(): MediaItem {
    val extras = Bundle().apply {
      putString(EXTRA_ALBUM_ID, albumId)
      putLong(EXTRA_DURATION, durationMs)
      if (artworkUri != null) putString(EXTRA_ARTWORK, artworkUri)
    }
    val metadata = MediaMetadata.Builder()
      .setTitle(title)
      .setArtist(artist)
      .setAlbumTitle(album)
      .setArtworkUri(artUri(albumId, id))
      .setDurationMs(if (durationMs > 0) durationMs else null)
      .setIsPlayable(true)
      .setIsBrowsable(false)
      .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
      .setExtras(extras)
      .build()
    return MediaItem.Builder()
      .setMediaId(id)
      .setUri(contentUri(id))
      .setMediaMetadata(metadata)
      .build()
  }

  fun toMap(gain: Double?): Map<String, Any?> = mapOf(
    "id" to id,
    "title" to title,
    "artist" to artist,
    "album" to album,
    "albumId" to albumId,
    "durationMs" to durationMs.toDouble(),
    "artworkUri" to artworkUri,
    "gainDb" to gain,
  )

  fun toJson(gain: Double?): JSONObject = JSONObject().apply {
    put("id", id)
    put("title", title)
    put("artist", artist)
    put("album", album)
    put("albumId", albumId)
    put("durationMs", durationMs)
    put("artworkUri", artworkUri ?: JSONObject.NULL)
    put("gainDb", gain ?: JSONObject.NULL)
  }

  companion object {
    const val ART_SCHEME = "thrum-art"
    private const val EXTRA_ALBUM_ID = "thrum.albumId"
    private const val EXTRA_DURATION = "thrum.durationMs"
    private const val EXTRA_ARTWORK = "thrum.artworkUri"

    fun contentUri(id: String): Uri =
      id.toLongOrNull()?.let { ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, it) }
        ?: Uri.parse(id)

    /** Resolved lazily by [ThrumBitmapLoader] so notification art never blocks queue building. */
    fun artUri(albumId: String, trackId: String): Uri = Uri.Builder()
      .scheme(ART_SCHEME)
      .authority("art")
      .appendQueryParameter("album", albumId)
      .appendQueryParameter("track", trackId)
      .build()

    fun fromMap(m: Map<String, Any?>): QueueItem? {
      val id = (m["id"] as? String)?.takeIf { it.isNotEmpty() } ?: return null
      return QueueItem(
        id = id,
        title = m["title"] as? String ?: "",
        artist = m["artist"] as? String ?: "",
        album = m["album"] as? String ?: "",
        albumId = (m["albumId"] as? String) ?: (m["albumId"] as? Number)?.toLong()?.toString() ?: "",
        durationMs = (m["durationMs"] as? Number)?.toLong() ?: 0L,
        artworkUri = m["artworkUri"] as? String,
        gainDb = (m["gainDb"] as? Number)?.toDouble()?.takeIf { it.isFinite() },
      )
    }

    fun fromJson(o: JSONObject?): QueueItem? {
      if (o == null) return null
      val id = o.optString("id").takeIf { it.isNotEmpty() } ?: return null
      return QueueItem(
        id = id,
        title = o.optString("title"),
        artist = o.optString("artist"),
        album = o.optString("album"),
        albumId = o.optString("albumId"),
        durationMs = o.optLong("durationMs"),
        artworkUri = if (o.isNull("artworkUri")) null else o.optString("artworkUri"),
        gainDb = if (o.isNull("gainDb")) null else o.optDouble("gainDb").takeIf { it.isFinite() },
      )
    }

    fun fromMediaItem(item: MediaItem): QueueItem {
      val md = item.mediaMetadata
      val extras = md.extras
      return QueueItem(
        id = item.mediaId,
        title = md.title?.toString() ?: "",
        artist = md.artist?.toString() ?: "",
        album = md.albumTitle?.toString() ?: "",
        albumId = extras?.getString(EXTRA_ALBUM_ID) ?: "",
        durationMs = extras?.getLong(EXTRA_DURATION) ?: md.durationMs ?: 0L,
        artworkUri = extras?.getString(EXTRA_ARTWORK),
        gainDb = null,
      )
    }
  }
}
