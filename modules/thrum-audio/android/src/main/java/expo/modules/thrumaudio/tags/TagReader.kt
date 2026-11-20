package expo.modules.thrumaudio.tags

import android.content.Context
import android.media.MediaExtractor
import android.media.MediaFormat
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.ParcelFileDescriptor
import java.util.Locale

/**
 * Embedded lyrics, ReplayGain and stream details for one track (`readTags` in JS). Tag parsing is
 * ours (the platform exposes neither lyrics nor ReplayGain); stream facts the tags lack come from
 * MediaExtractor, then MediaMetadataRetriever.
 */
internal object TagReader {
  private val LOSSLESS = setOf("FLAC", "ALAC", "PCM", "WavPack", "APE")

  fun read(context: Context, uri: Uri, mimeHint: String?): Map<String, Any?> {
    val tags = Tags()
    try {
      context.contentResolver.openFileDescriptor(uri, "r")?.let { pfd ->
        ParcelFileDescriptor.AutoCloseInputStream(pfd).use { TagParser.parse(ChannelSource(it.channel), tags) }
      }
    } catch (_: Exception) {
      // Unreadable or malformed file: whatever was parsed so far still counts.
    }

    val stream = extractorInfo(context, uri)
    if (stream.bitrate == null || stream.rate == null || stream.durationMs == null) retrieverInfo(context, uri, stream)

    val codec = tags.codec ?: codecOf(stream.mime ?: mimeHint)
    val lossless = codec in LOSSLESS
    val durationMs = stream.durationMs
    val audioBytes = tags.audioBytes
    val estimated = if (audioBytes != null && durationMs != null && durationMs > 0) audioBytes * 8_000.0 / durationMs else null
    val bitrate = stream.bitrate?.toDouble() ?: estimated
    val (lyrics, synced) = tags.lyrics()
    val bitDepth = if (lossless) (tags.bitDepth ?: stream.bits)?.takeIf { it in 4..64 } else null

    return mapOf(
      "lyrics" to lyrics,
      "synced" to synced,
      "replayGainTrackDb" to tags.trackGain,
      "replayGainAlbumDb" to tags.albumGain,
      "replayGainPeak" to tags.trackPeak,
      "sampleRate" to (tags.sampleRate ?: stream.rate)?.takeIf { it in 1000..1_536_000 },
      "channels" to (tags.channels ?: stream.channels)?.takeIf { it in 1..32 },
      "bitDepth" to bitDepth,
      "codec" to codec,
      "bitrate" to bitrate?.takeIf { it.isFinite() && it >= 1000 && it < 100_000_000 }?.toInt(),
    )
  }

  private class Stream {
    var mime: String? = null
    var rate: Int? = null
    var channels: Int? = null
    var bitrate: Int? = null
    var bits: Int? = null
    var durationMs: Long? = null
  }

  private fun extractorInfo(context: Context, uri: Uri): Stream {
    val out = Stream()
    val extractor = MediaExtractor()
    try {
      extractor.setDataSource(context, uri, null)
      for (i in 0 until extractor.trackCount) {
        val format = extractor.getTrackFormat(i)
        val mime = format.getString(MediaFormat.KEY_MIME) ?: continue
        if (!mime.startsWith("audio/")) continue
        out.mime = mime
        out.rate = format.int(MediaFormat.KEY_SAMPLE_RATE)
        out.channels = format.int(MediaFormat.KEY_CHANNEL_COUNT)
        out.bitrate = format.int(MediaFormat.KEY_BIT_RATE)?.takeIf { it > 0 }
        out.durationMs = format.long(MediaFormat.KEY_DURATION)?.let { it / 1000 }?.takeIf { it > 0 }
        break
      }
    } catch (_: Exception) {
    } finally {
      extractor.release()
    }
    return out
  }

  private fun retrieverInfo(context: Context, uri: Uri, into: Stream) {
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      fun key(k: Int) = retriever.extractMetadata(k)?.trim()
      if (into.bitrate == null) into.bitrate = key(MediaMetadataRetriever.METADATA_KEY_BITRATE)?.toIntOrNull()?.takeIf { it > 0 }
      if (into.durationMs == null) {
        into.durationMs = key(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.takeIf { it > 0 }
      }
      if (Build.VERSION.SDK_INT >= 31) {
        if (into.rate == null) into.rate = key(MediaMetadataRetriever.METADATA_KEY_SAMPLERATE)?.toIntOrNull()
        into.bits = key(MediaMetadataRetriever.METADATA_KEY_BITS_PER_SAMPLE)?.toIntOrNull()
      }
    } catch (_: Exception) {
    } finally {
      try {
        retriever.release()
      } catch (_: Exception) {
      }
    }
  }

  private fun MediaFormat.int(key: String): Int? =
    if (containsKey(key)) runCatching { getInteger(key) }.getOrNull() else null

  private fun MediaFormat.long(key: String): Long? =
    if (containsKey(key)) runCatching { getLong(key) }.getOrNull() else null

  fun codecOf(mime: String?): String? {
    val m = mime?.lowercase(Locale.ROOT) ?: return null
    return when (m) {
      "audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg" -> "MP3"
      "audio/mpeg-l2" -> "MP2"
      "audio/flac", "audio/x-flac" -> "FLAC"
      "audio/mp4a-latm", "audio/aac", "audio/aac-adts", "audio/x-aac", "audio/mp4", "audio/x-m4a" -> "AAC"
      "audio/opus" -> "Opus"
      "audio/vorbis", "audio/ogg", "application/ogg" -> "Vorbis"
      "audio/raw", "audio/wav", "audio/x-wav", "audio/wave", "audio/aiff", "audio/x-aiff" -> "PCM"
      "audio/alac" -> "ALAC"
      "audio/ac3" -> "AC-3"
      "audio/eac3" -> "E-AC-3"
      "audio/x-ms-wma" -> "WMA"
      "audio/amr-wb" -> "AMR-WB"
      "audio/3gpp", "audio/amr" -> "AMR"
      "audio/x-wavpack", "audio/wavpack" -> "WavPack"
      "audio/x-ape", "audio/ape" -> "APE"
      else -> m.substringAfter('/').substringAfter("x-").uppercase(Locale.ROOT).takeIf { it.isNotBlank() }
    }
  }
}
