package expo.modules.thrumaudio.library

import android.content.Context
import android.database.Cursor
import android.os.Build
import android.provider.MediaStore
import org.json.JSONArray
import org.json.JSONObject

/** Reads the MediaStore audio table into the `RawTrack` JSON shape (see ThrumAudio.types.ts). */
object MediaScanner {
  private val storagePrefix = Regex("^/storage/(emulated/\\d+|[^/]+)/")

  fun scan(context: Context, minDurationMs: Long, excludedFolders: List<String>): String {
    val excluded = excludedFolders.mapNotNull { normalizeFolder(it).takeIf { f -> f.isNotEmpty() }?.lowercase() }
    val genres = if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) legacyGenres(context) else emptyMap()
    val out = JSONArray()
    query(context, minDurationMs)?.use { c ->
      val col = Columns(c)
      while (c.moveToNext()) {
        val id = c.getLong(col.id)
        val fileName = c.str(col.displayName)
        val folder = folderOf(c, col)
        if (excluded.isNotEmpty()) {
          val lower = folder.lowercase()
          if (excluded.any { lower.startsWith(it) }) continue
        }
        val title = c.str(col.title).ifBlank { fileName.substringBeforeLast('.', fileName) }
        out.put(
          JSONObject()
            .put("id", id.toString())
            .put("title", title)
            .put("artist", c.str(col.artist))
            .put("album", c.str(col.album))
            .put("albumId", c.long(col.albumId).toString())
            .put("albumArtist", c.str(col.albumArtist))
            .put("genre", if (col.genre >= 0) c.str(col.genre) else genres[id] ?: "")
            .put("year", c.int(col.year))
            .put("track", c.int(col.track))
            .put("disc", leadingInt(c.str(col.disc)))
            .put("durationMs", c.long(col.duration))
            .put("folder", folder)
            .put("fileName", fileName)
            .put("mime", c.str(col.mime))
            .put("bitrate", c.long(col.bitrate))
            .put("size", c.long(col.size))
            .put("dateAdded", c.long(col.dateAdded) * 1000L)
            .put("dateModified", c.long(col.dateModified) * 1000L),
        )
      }
    }
    return out.toString()
  }

  private fun query(context: Context, minDurationMs: Long): Cursor? {
    val resolver = context.contentResolver
    val uri = MediaStore.Audio.Media.EXTERNAL_CONTENT_URI
    val selection = "${MediaStore.Audio.Media.IS_MUSIC} != 0 AND ${MediaStore.Audio.Media.DURATION} >= ?"
    val args = arrayOf(minDurationMs.coerceAtLeast(0L).toString())
    val order = "${MediaStore.Audio.Media.TITLE} COLLATE NOCASE ASC"
    val base = baseProjection()
    val extended = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      base + arrayOf(ALBUM_ARTIST, GENRE, BITRATE, DISC_NUMBER)
    } else {
      base + arrayOf(ALBUM_ARTIST)
    }
    // Some OEM builds lack optional columns; fall back to the guaranteed set.
    return runCatching { resolver.query(uri, extended, selection, args, order) }.getOrNull()
      ?: resolver.query(uri, base, selection, args, order)
  }

  private fun baseProjection(): Array<String> {
    val columns = mutableListOf(
      MediaStore.Audio.Media._ID,
      MediaStore.Audio.Media.TITLE,
      MediaStore.Audio.Media.ARTIST,
      MediaStore.Audio.Media.ALBUM,
      MediaStore.Audio.Media.ALBUM_ID,
      MediaStore.Audio.Media.YEAR,
      MediaStore.Audio.Media.TRACK,
      MediaStore.Audio.Media.DURATION,
      MediaStore.Audio.Media.DISPLAY_NAME,
      MediaStore.Audio.Media.MIME_TYPE,
      MediaStore.Audio.Media.SIZE,
      MediaStore.Audio.Media.DATE_ADDED,
      MediaStore.Audio.Media.DATE_MODIFIED,
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      columns.add(MediaStore.Audio.Media.RELATIVE_PATH)
    } else {
      @Suppress("DEPRECATION")
      columns.add(MediaStore.Audio.Media.DATA)
    }
    return columns.toTypedArray()
  }

  private class Columns(c: Cursor) {
    val id = c.getColumnIndexOrThrow(MediaStore.Audio.Media._ID)
    val title = c.getColumnIndex(MediaStore.Audio.Media.TITLE)
    val artist = c.getColumnIndex(MediaStore.Audio.Media.ARTIST)
    val album = c.getColumnIndex(MediaStore.Audio.Media.ALBUM)
    val albumId = c.getColumnIndex(MediaStore.Audio.Media.ALBUM_ID)
    val year = c.getColumnIndex(MediaStore.Audio.Media.YEAR)
    val track = c.getColumnIndex(MediaStore.Audio.Media.TRACK)
    val duration = c.getColumnIndex(MediaStore.Audio.Media.DURATION)
    val displayName = c.getColumnIndex(MediaStore.Audio.Media.DISPLAY_NAME)
    val mime = c.getColumnIndex(MediaStore.Audio.Media.MIME_TYPE)
    val size = c.getColumnIndex(MediaStore.Audio.Media.SIZE)
    val dateAdded = c.getColumnIndex(MediaStore.Audio.Media.DATE_ADDED)
    val dateModified = c.getColumnIndex(MediaStore.Audio.Media.DATE_MODIFIED)
    val relativePath = c.getColumnIndex("relative_path")
    val data = c.getColumnIndex("_data")
    val albumArtist = c.getColumnIndex(ALBUM_ARTIST)
    val genre = c.getColumnIndex(GENRE)
    val bitrate = c.getColumnIndex(BITRATE)
    val disc = c.getColumnIndex(DISC_NUMBER)
  }

  private fun folderOf(c: Cursor, col: Columns): String {
    if (col.relativePath >= 0) {
      val relative = c.str(col.relativePath)
      if (relative.isNotEmpty()) return normalizeFolder(relative)
    }
    if (col.data >= 0) {
      val path = c.str(col.data)
      val parent = path.substringBeforeLast('/', "")
      return normalizeFolder(parent.replaceFirst(storagePrefix, ""))
    }
    return ""
  }

  /** `Music/Arijit Singh/` style: no leading slash, trailing slash, single separators. */
  fun normalizeFolder(raw: String): String {
    val parts = raw.replace('\\', '/').split('/').filter { it.isNotBlank() }
    return if (parts.isEmpty()) "" else parts.joinToString("/", postfix = "/")
  }

  fun leadingInt(value: String): Int = value.trim().takeWhile { it.isDigit() }.take(6).toIntOrNull() ?: 0

  /** API < 30 has no GENRE column: walk Genres -> Members once. */
  private fun legacyGenres(context: Context): Map<Long, String> {
    val result = HashMap<Long, String>()
    val resolver = context.contentResolver
    runCatching {
      resolver.query(
        MediaStore.Audio.Genres.EXTERNAL_CONTENT_URI,
        arrayOf(MediaStore.Audio.Genres._ID, MediaStore.Audio.Genres.NAME),
        null, null, null,
      )?.use { g ->
        while (g.moveToNext()) {
          val genreId = g.getLong(0)
          val name = g.getString(1)?.trim().orEmpty()
          if (name.isEmpty()) continue
          resolver.query(
            MediaStore.Audio.Genres.Members.getContentUri("external", genreId),
            arrayOf(MediaStore.Audio.Genres.Members.AUDIO_ID),
            null, null, null,
          )?.use { m -> while (m.moveToNext()) result.putIfAbsent(m.getLong(0), name) }
        }
      }
    }
    return result
  }

  private fun Cursor.str(index: Int): String = if (index < 0 || isNull(index)) "" else getString(index)?.trim().orEmpty()
  private fun Cursor.int(index: Int): Int = if (index < 0 || isNull(index)) 0 else getInt(index)
  private fun Cursor.long(index: Int): Long = if (index < 0 || isNull(index)) 0L else getLong(index)

  private const val ALBUM_ARTIST = "album_artist"
  private const val GENRE = "genre"
  private const val BITRATE = "bitrate"
  private const val DISC_NUMBER = "disc_number"
}
