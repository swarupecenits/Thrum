package expo.modules.thrumaudio.library

import android.content.ContentUris
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import android.util.Size
import androidx.palette.graphics.Palette
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.ConcurrentHashMap
import kotlin.math.min

/**
 * Square JPEG artwork in two sizes plus an androidx.palette colour set, cached under
 * `cacheDir/art`. Albums share one entry; tracks without a usable album id get their own.
 */
object ArtworkCache {
  private const val LG = 1080
  private const val SM = 160
  private const val RESUME = 540
  private const val NONE_TTL_MS = 3L * 24 * 60 * 60 * 1000

  class Entry(val sm: File, val lg: File, val palette: Map<String, Any?>?)

  private val locks = ConcurrentHashMap<String, Any>()

  fun dir(context: Context): File = File(context.cacheDir, "art").apply { mkdirs() }

  fun key(albumId: String, trackId: String): String? {
    val album = clean(albumId)
    if (album.isNotEmpty() && album != "0" && album != "-1") return "a$album"
    val track = clean(trackId)
    return if (track.isNotEmpty()) "t$track" else null
  }

  /** Keeps keys file-name safe (ids are numeric MediaStore ids; anything else is stripped). */
  private fun clean(id: String): String = id.filter { it.isLetterOrDigit() || it == '-' || it == '_' }.take(48)

  /** Blocking; returns the module's `ArtworkResult` shape. */
  fun get(context: Context, albumId: String, trackId: String, size: String): Map<String, Any?> {
    val entry = ensure(context, albumId, trackId) ?: return mapOf("uri" to null, "palette" to null)
    val file = if (size == "sm") entry.sm else entry.lg
    return mapOf("uri" to Uri.fromFile(file).toString(), "palette" to entry.palette)
  }

  fun ensure(context: Context, albumId: String, trackId: String): Entry? {
    val key = key(albumId, trackId) ?: return null
    val dir = dir(context)
    val sm = File(dir, "${key}_sm.jpg")
    val lg = File(dir, "${key}_lg.jpg")
    val pal = File(dir, "$key.pal.json")
    val none = File(dir, "$key.none")
    synchronized(locks.getOrPut(key) { Any() }) {
      if (sm.exists() && lg.exists()) return Entry(sm, lg, readPalette(pal))
      if (none.exists() && System.currentTimeMillis() - none.lastModified() < NONE_TTL_MS) return null
      val source = loadSource(context, albumId, trackId, key.startsWith("a"))
      if (source == null) {
        runCatching { none.writeText("") }
        return null
      }
      return try {
        val square = centerSquare(source)
        val large = scaleDown(square, LG)
        val small = scaleDown(large, SM)
        writeJpeg(large, lg, 90)
        writeJpeg(small, sm, 85)
        val palette = palette(small)
        runCatching { pal.writeText(JSONObject(palette).toString()) }
        none.delete()
        Entry(sm, lg, palette)
      } catch (e: Exception) {
        null
      }
    }
  }

  fun notificationBitmap(context: Context, albumId: String, trackId: String): Bitmap? {
    val entry = ensure(context, albumId, trackId) ?: return null
    return BitmapFactory.decodeFile(entry.lg.path)
  }

  /** Small JPEG for the System UI resumption card (sent over binder, so kept compact). */
  fun resumptionJpeg(context: Context, albumId: String, trackId: String): ByteArray? {
    val entry = ensure(context, albumId, trackId) ?: return null
    val bitmap = decodeFileSampled(entry.lg, RESUME) ?: return null
    val scaled = scaleDown(bitmap, RESUME)
    return ByteArrayOutputStream().use { out ->
      scaled.compress(Bitmap.CompressFormat.JPEG, 85, out)
      out.toByteArray()
    }
  }

  fun clear(context: Context) {
    dir(context).listFiles()?.forEach { it.delete() }
  }

  fun decodeSampled(bytes: ByteArray, target: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val options = BitmapFactory.Options().apply {
      inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, target)
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    return BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)
  }

  private fun decodeFileSampled(file: File, target: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(file.path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    val options = BitmapFactory.Options().apply { inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, target) }
    return BitmapFactory.decodeFile(file.path, options)
  }

  private fun sampleSize(width: Int, height: Int, target: Int): Int {
    var sample = 1
    while (min(width, height) / (sample * 2) >= target) sample *= 2
    return sample
  }

  private fun loadSource(context: Context, albumId: String, trackId: String, albumKeyed: Boolean): Bitmap? {
    val resolver = context.contentResolver
    val trackUri = trackId.toLongOrNull()?.let { ContentUris.withAppendedId(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, it) }
    val albumNumber = albumId.toLongOrNull()?.takeIf { it > 0 }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      // MediaStore thumbnails cover embedded art and folder images (cover.jpg, folder.jpg, AlbumArt*.jpg).
      trackUri?.let { uri -> runCatching { resolver.loadThumbnail(uri, Size(LG, LG), null) }.getOrNull() }
        ?.let { return software(it) }
      if (albumKeyed && albumNumber != null) {
        val albumUri = ContentUris.withAppendedId(MediaStore.Audio.Albums.EXTERNAL_CONTENT_URI, albumNumber)
        runCatching { resolver.loadThumbnail(albumUri, Size(LG, LG), null) }.getOrNull()?.let { return software(it) }
      }
    }
    trackUri?.let { embedded(context, it) }?.let { return it }
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && albumNumber != null) {
      val legacy = ContentUris.withAppendedId(Uri.parse("content://media/external/audio/albumart"), albumNumber)
      runCatching {
        resolver.openInputStream(legacy)?.use { it.readBytes() }?.let { decodeSampled(it, LG) }
      }.getOrNull()?.let { return it }
    }
    return null
  }

  private fun embedded(context: Context, uri: Uri): Bitmap? {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(context, uri)
      retriever.embeddedPicture?.let { decodeSampled(it, LG) }
    } catch (e: Exception) {
      null
    } finally {
      runCatching { retriever.release() }
    }
  }

  private fun software(bitmap: Bitmap): Bitmap =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && bitmap.config == Bitmap.Config.HARDWARE) {
      bitmap.copy(Bitmap.Config.ARGB_8888, false)
    } else {
      bitmap
    }

  private fun centerSquare(bitmap: Bitmap): Bitmap {
    val side = min(bitmap.width, bitmap.height)
    if (bitmap.width == bitmap.height) return bitmap
    return Bitmap.createBitmap(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side)
  }

  private fun scaleDown(bitmap: Bitmap, target: Int): Bitmap =
    if (bitmap.width <= target) bitmap else Bitmap.createScaledBitmap(bitmap, target, target, true)

  private fun writeJpeg(bitmap: Bitmap, file: File, quality: Int) {
    val tmp = File(file.parentFile, "${file.name}.tmp")
    FileOutputStream(tmp).use { bitmap.compress(Bitmap.CompressFormat.JPEG, quality, it) }
    if (!tmp.renameTo(file)) {
      tmp.delete()
      throw java.io.IOException("Could not store artwork")
    }
  }

  private fun palette(bitmap: Bitmap): Map<String, Any?> {
    val p = Palette.from(bitmap).maximumColorCount(16).generate()
    fun hex(rgb: Int?): String? = rgb?.let { String.format("#%06X", 0xFFFFFF and it) }
    return mapOf(
      "dominant" to hex(p.dominantSwatch?.rgb),
      "vibrant" to hex(p.vibrantSwatch?.rgb),
      "darkVibrant" to hex(p.darkVibrantSwatch?.rgb),
      "lightVibrant" to hex(p.lightVibrantSwatch?.rgb),
      "muted" to hex(p.mutedSwatch?.rgb),
      "darkMuted" to hex(p.darkMutedSwatch?.rgb),
      "lightMuted" to hex(p.lightMutedSwatch?.rgb),
    )
  }

  private fun readPalette(file: File): Map<String, Any?>? = runCatching {
    val json = JSONObject(file.readText())
    PALETTE_KEYS.associateWith { k -> if (json.isNull(k)) null else json.optString(k).takeIf { it.startsWith("#") } }
  }.getOrNull()

  private val PALETTE_KEYS = listOf("dominant", "vibrant", "darkVibrant", "lightVibrant", "muted", "darkMuted", "lightMuted")
}
