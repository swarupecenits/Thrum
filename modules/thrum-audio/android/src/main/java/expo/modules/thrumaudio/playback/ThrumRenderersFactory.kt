package expo.modules.thrumaudio.playback

import android.content.Context
import android.os.Handler
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.PlaybackParameters
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.util.UnstableApi
import androidx.media3.common.util.Util
import androidx.media3.exoplayer.Renderer
import androidx.media3.exoplayer.RenderersFactory
import androidx.media3.exoplayer.audio.AudioRendererEventListener
import androidx.media3.exoplayer.audio.AudioSink
import androidx.media3.exoplayer.audio.DefaultAudioSink
import androidx.media3.exoplayer.audio.ForwardingAudioSink
import androidx.media3.exoplayer.audio.MediaCodecAudioRenderer
import androidx.media3.exoplayer.mediacodec.MediaCodecSelector
import androidx.media3.exoplayer.metadata.MetadataOutput
import androidx.media3.exoplayer.text.TextOutput
import androidx.media3.exoplayer.video.VideoRendererEventListener
import expo.modules.thrumaudio.dsp.DspAudioProcessor
import java.nio.ByteBuffer

/**
 * Audio-only renderers: one MediaCodec audio renderer whose sink runs the Thrum DSP chain before
 * Media3's own silence-skipping and speed processors. Output stays 16-bit so processing is always
 * available (float output disables the processor chain).
 */
@OptIn(UnstableApi::class)
class ThrumRenderersFactory(private val context: Context) : RenderersFactory {
  override fun createRenderers(
    eventHandler: Handler,
    videoRendererEventListener: VideoRendererEventListener,
    audioRendererEventListener: AudioRendererEventListener,
    textRendererOutput: TextOutput,
    metadataRendererOutput: MetadataOutput,
  ): Array<Renderer> {
    val sink = DefaultAudioSink.Builder(context)
      .setAudioProcessors(arrayOf<AudioProcessor>(DspAudioProcessor()))
      .setEnableFloatOutput(false)
      .build()
    val tracked = LatencyTrackingSink(sink)
    LatencyTrackingSink.current = tracked
    return arrayOf(
      MediaCodecAudioRenderer(
        context,
        MediaCodecSelector.DEFAULT,
        /* enableDecoderFallback= */ true,
        eventHandler,
        audioRendererEventListener,
        tracked,
      ),
    )
  }
}

/**
 * Remembers how far the sink has been fed ahead of what is audible, so the spectrum shown on screen
 * lines up with what the listener hears (Bluetooth adds 150-250 ms).
 */
@OptIn(UnstableApi::class)
class LatencyTrackingSink(sink: AudioSink) : ForwardingAudioSink(sink) {
  @Volatile private var bytesPerFrame = 4
  @Volatile private var sampleRate = 44_100
  @Volatile private var bufferPtsUs = C.TIME_UNSET
  @Volatile private var bufferBytes = 0
  @Volatile private var fedUntilUs = C.TIME_UNSET
  @Volatile private var positionUs = C.TIME_UNSET
  @Volatile private var positionStampNs = 0L
  @Volatile private var playing = false
  @Volatile private var speed = 1f

  override fun configure(audioSinkConfig: AudioSink.AudioSinkConfig) {
    val format = audioSinkConfig.format
    if (format.sampleRate > 0) sampleRate = format.sampleRate
    if (format.channelCount > 0 && format.pcmEncoding != androidx.media3.common.Format.NO_VALUE) {
      bytesPerFrame = Util.getPcmFrameSize(format.pcmEncoding, format.channelCount).coerceAtLeast(1)
    }
    super.configure(audioSinkConfig)
  }

  override fun handleBuffer(buffer: ByteBuffer, presentationTimeUs: Long, encodedAccessUnitCount: Int): Boolean {
    if (presentationTimeUs != bufferPtsUs) {
      bufferPtsUs = presentationTimeUs
      bufferBytes = buffer.remaining()
    }
    val consumed = super.handleBuffer(buffer, presentationTimeUs, encodedAccessUnitCount)
    if (consumed) {
      fedUntilUs = presentationTimeUs + bufferBytes.toLong() / bytesPerFrame * 1_000_000L / sampleRate
    }
    return consumed
  }

  override fun getCurrentPositionUs(sourceEnded: Boolean): Long {
    val position = super.getCurrentPositionUs(sourceEnded)
    if (position != AudioSink.CURRENT_POSITION_NOT_SET) {
      positionUs = position
      positionStampNs = System.nanoTime()
    }
    return position
  }

  override fun play() {
    super.play()
    playing = true
  }

  override fun pause() {
    super.pause()
    playing = false
  }

  override fun setPlaybackParameters(playbackParameters: PlaybackParameters) {
    super.setPlaybackParameters(playbackParameters)
    speed = playbackParameters.speed
  }

  override fun flush() {
    super.flush()
    reset()
  }

  override fun reset() {
    super.reset()
    playing = false
    bufferPtsUs = C.TIME_UNSET
    fedUntilUs = C.TIME_UNSET
    positionUs = C.TIME_UNSET
  }

  /** Media time between the newest processed sample and the sample being heard right now. */
  fun latencyUs(): Long {
    val fed = fedUntilUs
    val heard = positionUs
    if (fed == C.TIME_UNSET || heard == C.TIME_UNSET) return 0L
    val elapsedUs = if (playing) (System.nanoTime() - positionStampNs) / 1_000L else 0L
    return (fed - heard - (elapsedUs * speed).toLong()).coerceIn(0L, 2_000_000L)
  }

  fun sampleRate(): Int = sampleRate

  companion object {
    @Volatile var current: LatencyTrackingSink? = null
  }
}
