package expo.modules.thrumaudio.dsp

import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import androidx.media3.common.audio.BaseAudioProcessor
import androidx.media3.common.util.UnstableApi
import java.nio.ByteBuffer
import kotlin.math.abs
import kotlin.math.min

/**
 * Media3 audio processor hosting [DspChain]. Accepts 16-bit or float PCM, mono or stereo, and always
 * emits 16-bit (what the sink's later processors expect when float output is off). Anything else
 * passes through untouched.
 *
 * The chain has a small fixed delay (limiter lookahead). After each flush the first [DspChain.latency]
 * output frames are dropped and at end of stream the same number are drained, so output length
 * equals input length and gapless playback stays sample-accurate.
 */
@OptIn(UnstableApi::class)
class DspAudioProcessor : BaseAudioProcessor() {
  private var chain: DspChain? = null
  private var floatInput = false
  private var channels = 2
  private var prime = 0
  private var endQueued = false
  private var drainPending = false
  private val left = DoubleArray(DspChain.BLOCK)
  private val right = DoubleArray(DspChain.BLOCK)
  private var noise = 0x2545F491

  override fun onConfigure(inputAudioFormat: AudioFormat): AudioFormat {
    val encoding = inputAudioFormat.encoding
    val supported = inputAudioFormat.channelCount in 1..2 &&
      inputAudioFormat.sampleRate in 8_000..384_000 &&
      (encoding == C.ENCODING_PCM_16BIT || encoding == C.ENCODING_PCM_FLOAT)
    if (!supported) return AudioFormat.NOT_SET
    return AudioFormat(inputAudioFormat.sampleRate, inputAudioFormat.channelCount, C.ENCODING_PCM_16BIT)
  }

  override fun onFlush(streamMetadata: AudioProcessor.StreamMetadata) {
    val format = inputAudioFormat
    endQueued = false
    drainPending = false
    if (format == AudioFormat.NOT_SET) {
      chain = null
      prime = 0
      return
    }
    floatInput = format.encoding == C.ENCODING_PCM_FLOAT
    channels = format.channelCount
    val current = chain
    val next = if (current != null && current.sampleRate == format.sampleRate && current.channels == channels) {
      current.also { it.reset() }
    } else {
      DspChain(format.sampleRate, channels)
    }
    chain = next
    prime = next.latency
    DspEngine.tap.configure(format.sampleRate)
  }

  override fun queueInput(inputBuffer: ByteBuffer) {
    val c = chain
    if (c == null || !inputBuffer.hasRemaining()) return
    val frameBytes = (if (floatInput) 4 else 2) * channels
    val frames = inputBuffer.remaining() / frameBytes
    if (frames == 0) return
    val outFrames = frames - min(prime, frames)
    val out = if (outFrames > 0) replaceOutputBuffer(outFrames * channels * 2) else null
    var pos = inputBuffer.position()
    var remaining = frames
    val stereo = channels == 2
    while (remaining > 0) {
      val n = min(remaining, DspChain.BLOCK)
      if (floatInput) {
        for (i in 0 until n) {
          left[i] = inputBuffer.getFloat(pos).toDouble(); pos += 4
          if (stereo) { right[i] = inputBuffer.getFloat(pos).toDouble(); pos += 4 }
        }
      } else {
        for (i in 0 until n) {
          left[i] = inputBuffer.getShort(pos) / 32768.0; pos += 2
          if (stereo) { right[i] = inputBuffer.getShort(pos) / 32768.0; pos += 2 }
        }
      }
      c.process(left, right, n)
      emit(out, n, c.exactDry)
      remaining -= n
    }
    inputBuffer.position(pos)
    out?.flip()
    DspEngine.tap.touch(System.nanoTime())
  }

  override fun onQueueEndOfStream() {
    // The pipeline may signal end of stream repeatedly; drain once, and only after our last output
    // has been consumed (see getOutput).
    if (endQueued) return
    endQueued = true
    val c = chain ?: return
    drainPending = c.latency - prime > 0
  }

  override fun getOutput(): ByteBuffer {
    if (drainPending && super.isEnded()) {
      drainPending = false
      drain()
    }
    return super.getOutput()
  }

  override fun isEnded(): Boolean = super.isEnded() && !drainPending

  override fun onReset() {
    chain = null
    prime = 0
    endQueued = false
    drainPending = false
  }

  /** Pushes silence through the chain to release the frames still held by the lookahead. */
  private fun drain() {
    val c = chain ?: return
    val held = c.latency - prime
    if (held <= 0) return
    val out = replaceOutputBuffer(held * channels * 2)
    var remaining = c.latency
    while (remaining > 0) {
      val n = min(remaining, DspChain.BLOCK)
      left.fill(0.0, 0, n)
      right.fill(0.0, 0, n)
      c.process(left, right, n)
      emit(out, n, c.exactDry)
      remaining -= n
    }
    out.flip()
  }

  private fun emit(out: ByteBuffer?, n: Int, exact: Boolean) {
    var start = 0
    if (prime > 0) {
      start = min(prime, n)
      prime -= start
    }
    if (out == null) return
    val stereo = channels == 2
    for (i in start until n) {
      out.putShort(toPcm16(left[i], exact))
      if (stereo) out.putShort(toPcm16(right[i], exact))
    }
  }

  /** Float to 16-bit with TPDF dither; the fully dry path is rounded only, which is lossless for 16-bit input. */
  private fun toPcm16(sample: Double, exact: Boolean): Short {
    var v = sample * 32768.0
    if (!exact) {
      if (abs(v) < 0.5) return 0
      v += tpdf()
    }
    val rounded = Math.round(v)
    return when {
      rounded > Short.MAX_VALUE -> Short.MAX_VALUE
      rounded < Short.MIN_VALUE -> Short.MIN_VALUE
      else -> rounded.toInt().toShort()
    }
  }

  /** Triangular dither in [-1, 1) LSB from two xorshift uniforms. */
  private fun tpdf(): Double {
    var x = noise
    x = x xor (x shl 13); x = x xor (x ushr 17); x = x xor (x shl 5)
    val a = (x ushr 8) * INV_2_24
    x = x xor (x shl 13); x = x xor (x ushr 17); x = x xor (x shl 5)
    val b = (x ushr 8) * INV_2_24
    noise = x
    return a - b
  }

  private companion object {
    const val INV_2_24 = 1.0 / 16_777_216.0
  }
}
