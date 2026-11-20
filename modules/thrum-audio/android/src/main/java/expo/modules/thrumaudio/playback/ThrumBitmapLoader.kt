package expo.modules.thrumaudio.playback

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RadialGradient
import android.graphics.Shader
import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.util.BitmapLoader
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import com.google.common.util.concurrent.ListenableFuture
import com.google.common.util.concurrent.ListeningExecutorService
import com.google.common.util.concurrent.MoreExecutors
import expo.modules.thrumaudio.library.ArtworkCache
import java.io.File
import java.io.IOException
import java.util.concurrent.Callable
import java.util.concurrent.Executors

/**
 * Loads notification / lock-screen artwork. `thrum-art://` URIs resolve through [ArtworkCache]
 * (MediaStore thumbnail, embedded picture, folder art), falling back to a branded placeholder.
 * Only our own scheme and our own cache files are ever decoded.
 */
@OptIn(UnstableApi::class)
class ThrumBitmapLoader(context: Context) : BitmapLoader {
  private val app = context.applicationContext

  override fun supportsMimeType(mimeType: String): Boolean = Util.isBitmapFactorySupportedMimeType(mimeType)

  override fun decodeBitmap(data: ByteArray): ListenableFuture<Bitmap> = executor.submit(
    Callable {
      ArtworkCache.decodeSampled(data, MAX_SIZE) ?: throw IOException("Unreadable artwork")
    },
  )

  override fun loadBitmap(uri: Uri): ListenableFuture<Bitmap> = executor.submit(
    Callable {
      when (uri.scheme) {
        QueueItem.ART_SCHEME -> {
          val album = uri.getQueryParameter("album") ?: ""
          val track = uri.getQueryParameter("track") ?: ""
          ArtworkCache.notificationBitmap(app, album, track) ?: Placeholder.bitmap()
        }
        "file" -> {
          val path = uri.path ?: throw IOException("Bad artwork path")
          val file = File(path).canonicalFile
          if (!file.path.startsWith(ArtworkCache.dir(app).canonicalPath)) throw IOException("Artwork outside cache")
          BitmapFactory.decodeFile(file.path) ?: throw IOException("Unreadable artwork")
        }
        else -> throw IOException("Unsupported artwork URI")
      }
    },
  )

  private companion object {
    const val MAX_SIZE = 1080
    val executor: ListeningExecutorService = MoreExecutors.listeningDecorator(
      Executors.newSingleThreadExecutor { r ->
        Thread(r, "thrum-art-session").apply {
          isDaemon = true
          priority = Thread.NORM_PRIORITY - 1
        }
      },
    )
  }
}

/** Ink & Lime placeholder: dark surface, lime glow and quiet rings (no text, so it works at any size). */
object Placeholder {
  @Volatile private var cached: Bitmap? = null

  fun bitmap(): Bitmap = cached ?: synchronized(this) { cached ?: draw().also { cached = it } }

  private fun draw(): Bitmap {
    val size = 512
    val center = size / 2f
    val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(bitmap)
    canvas.drawColor(0xFF121215.toInt())
    val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      shader = RadialGradient(
        center, size * 0.6f, size * 0.7f,
        intArrayOf(0x55BEF264, 0x18BEF264, 0x00BEF264),
        floatArrayOf(0f, 0.5f, 1f),
        Shader.TileMode.CLAMP,
      )
    }
    canvas.drawRect(0f, 0f, size.toFloat(), size.toFloat(), glow)
    val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      style = Paint.Style.STROKE
      strokeWidth = 3f
      color = 0xFFBEF264.toInt()
    }
    for (i in 1..4) {
      ring.alpha = 120 - i * 24
      canvas.drawCircle(center, center, size * 0.085f * i, ring)
    }
    val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFBEF264.toInt() }
    canvas.drawCircle(center, center, size * 0.03f, dot)
    return bitmap
  }
}
