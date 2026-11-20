package expo.modules.thrumaudio.analysis

import android.content.Context
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.SystemClock
import java.io.IOException
import java.nio.ByteBuffer
import java.nio.ByteOrder

/**
 * Decodes a window of a track with the platform codecs and feeds the PCM to [FeatureExtractor].
 * Long tracks are sampled in their middle 30 s (past the intro, before the outro); short ones whole.
 */
internal class TrackAnalyzer(private val context: Context) {

  /** Null when the file has no audio the device can decode. [cancelled] is polled every codec step. */
  fun analyze(uri: Uri, durationMs: Long, cancelled: () -> Boolean): TrackFeatures? {
    val extractor = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      extractor.setDataSource(context, uri, null)
      val track = (0 until extractor.trackCount).firstOrNull {
        extractor.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true
      } ?: return null
      val format = extractor.getTrackFormat(track)
      val mime = format.getString(MediaFormat.KEY_MIME) ?: return null
      extractor.selectTrack(track)

      val knownUs = if (format.containsKey(MediaFormat.KEY_DURATION)) format.getLong(MediaFormat.KEY_DURATION) else 0L
      val totalUs = if (knownUs > 0) knownUs else durationMs * 1000L
      val startUs: Long
      val windowUs: Long
      if (totalUs in 1..WHOLE_TRACK_US) {
        startUs = 0L
        windowUs = totalUs
      } else {
        windowUs = WINDOW_US
        startUs = if (totalUs > 0) (totalUs - WINDOW_US) / 2 else 0L
      }
      if (startUs > 0) extractor.seekTo(startUs, MediaExtractor.SEEK_TO_PREVIOUS_SYNC)

      val decoder = try {
        MediaCodec.createDecoderByType(mime)
      } catch (_: IOException) {
        return null
      } catch (_: IllegalArgumentException) {
        return null
      }
      codec = decoder
      try {
        decoder.configure(format, null, null, 0)
      } catch (_: IllegalArgumentException) {
        return null
      } catch (_: MediaCodec.CodecException) {
        return null
      }
      decoder.start()
      return decode(extractor, decoder, startUs, windowUs, cancelled)
    } finally {
      codec?.let { c ->
        runCatching { c.stop() }
        runCatching { c.release() }
      }
      extractor.release()
    }
  }

  private fun decode(
    extractor: MediaExtractor,
    codec: MediaCodec,
    startUs: Long,
    windowUs: Long,
    cancelled: () -> Boolean,
  ): TrackFeatures? {
    val info = MediaCodec.BufferInfo()
    val deadline = SystemClock.elapsedRealtime() + MAX_WALL_MS
    var inputDone = false
    var pending: Pcm? = null
    var pcm: Pcm? = null
    var features: FeatureExtractor? = null
    var droppedUs = 0L
    var left = DoubleArray(0)
    var right = DoubleArray(0)

    while (!cancelled() && SystemClock.elapsedRealtime() < deadline) {
      if (!inputDone) {
        val index = codec.dequeueInputBuffer(TIMEOUT_US)
        if (index >= 0) {
          val buffer = codec.getInputBuffer(index)
          val size = if (buffer == null) -1 else extractor.readSampleData(buffer, 0)
          if (size < 0) {
            codec.queueInputBuffer(index, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
            inputDone = true
          } else {
            codec.queueInputBuffer(index, 0, size, extractor.sampleTime.coerceAtLeast(0), 0)
            extractor.advance()
          }
        }
      }

      val out = codec.dequeueOutputBuffer(info, TIMEOUT_US)
      if (out == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
        pending = Pcm.of(codec.outputFormat)
        continue
      }
      if (out < 0) continue

      val eos = info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM != 0
      val format = pending ?: pcm ?: Pcm.of(codec.getOutputFormat(out))
      pending = null
      if (pcm != null && !format.sameAs(pcm)) {
        // Mid-stream format switches are rare; what we have is enough.
        codec.releaseOutputBuffer(out, false)
        break
      }
      if (!format.supported) {
        codec.releaseOutputBuffer(out, false)
        return null
      }
      pcm = format
      val frames = info.size / format.frameBytes
      val bufferUs = frames * 1_000_000L / format.rate
      val buffer = codec.getOutputBuffer(out)
      if (startUs > 0 && info.presentationTimeUs + bufferUs <= startUs && droppedUs < MAX_DROP_US) {
        droppedUs += bufferUs
      } else if (buffer != null && frames > 0) {
        val fx = features ?: FeatureExtractor(format.rate, windowUs / 1e6 + 0.25).also { features = it }
        if (left.size < frames) {
          left = DoubleArray(frames)
          right = DoubleArray(frames)
        }
        buffer.order(ByteOrder.nativeOrder())
        format.read(buffer, info.offset, frames, left, right)
        fx.push(left, if (format.channels >= 2) right else null, frames)
      }
      codec.releaseOutputBuffer(out, false)
      if (eos || features?.full == true) break
    }
    if (cancelled()) return null
    return features?.finish()
  }

  /** Decoder output layout. Only the first two channels are used. */
  private class Pcm(val rate: Int, val channels: Int, val encoding: Int) {
    val bytes = when (encoding) {
      PCM_8 -> 1
      PCM_16 -> 2
      PCM_24 -> 3
      PCM_FLOAT, PCM_32 -> 4
      else -> 0
    }
    val frameBytes = maxOf(1, bytes * channels)
    val supported = bytes > 0 && channels > 0 && rate >= MIN_RATE

    fun sameAs(o: Pcm) = rate == o.rate && channels == o.channels && encoding == o.encoding

    fun read(b: ByteBuffer, offset: Int, frames: Int, left: DoubleArray, right: DoubleArray) {
      for (i in 0 until frames) {
        val p = offset + i * frameBytes
        left[i] = sample(b, p)
        right[i] = if (channels >= 2) sample(b, p + bytes) else left[i]
      }
    }

    private fun sample(b: ByteBuffer, p: Int): Double = when (encoding) {
      PCM_16 -> b.getShort(p) / 32768.0
      PCM_FLOAT -> b.getFloat(p).toDouble()
      PCM_8 -> ((b.get(p).toInt() and 0xFF) - 128) / 128.0
      PCM_24 -> {
        val v = (b.get(p).toInt() and 0xFF) or ((b.get(p + 1).toInt() and 0xFF) shl 8) or (b.get(p + 2).toInt() shl 16)
        v / 8_388_608.0
      }
      PCM_32 -> b.getInt(p) / 2_147_483_648.0
      else -> 0.0
    }

    companion object {
      fun of(f: MediaFormat) = Pcm(
        if (f.containsKey(MediaFormat.KEY_SAMPLE_RATE)) f.getInteger(MediaFormat.KEY_SAMPLE_RATE) else 0,
        if (f.containsKey(MediaFormat.KEY_CHANNEL_COUNT)) f.getInteger(MediaFormat.KEY_CHANNEL_COUNT) else 0,
        if (f.containsKey(MediaFormat.KEY_PCM_ENCODING)) f.getInteger(MediaFormat.KEY_PCM_ENCODING) else PCM_16,
      )
    }
  }

  private companion object {
    const val WINDOW_US = 30_000_000L
    const val WHOLE_TRACK_US = 45_000_000L
    const val MAX_DROP_US = 10_000_000L
    const val MAX_WALL_MS = 20_000L
    const val TIMEOUT_US = 10_000L
    const val MIN_RATE = 8_000

    // android.media.AudioFormat encodings (24/32-bit constants are API 31, so mirrored here).
    const val PCM_16 = 2
    const val PCM_8 = 3
    const val PCM_FLOAT = 4
    const val PCM_24 = 21
    const val PCM_32 = 22
  }
}
