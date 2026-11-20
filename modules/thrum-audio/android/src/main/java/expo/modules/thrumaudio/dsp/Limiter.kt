package expo.modules.thrumaudio.dsp

import kotlin.math.abs
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * Stereo-linked lookahead peak limiter.
 *
 * Gain path per sample: required gain -> trailing minimum over the lookahead window -> release
 * smoothing (never above the minimum) -> moving average over the window. The signal is delayed by
 * window - 1 samples, which makes every output sample provably <= the ceiling while the gain still
 * moves smoothly (no clicks, no overs).
 */
internal class Limiter(sampleRate: Int, private val channels: Int) {
  val window: Int = (sampleRate * LOOKAHEAD_SEC).roundToInt().coerceIn(16, 512)

  /** Signal delay in frames. */
  val delay: Int get() = window - 1

  /** When false the gain relaxes to unity but the delay is kept so timing never jumps. */
  var enabled = true

  /** Lowest gain applied during the last [process] call. */
  var blockMinGain = 1.0
    private set

  private val ceiling = 10.0.pow(CEILING_DB / 20.0)
  private val release = 1.0 - exp(-1.0 / (RELEASE_SEC * sampleRate))

  private val delayL = DoubleArray(window)
  private val delayR = DoubleArray(window)
  private var delayPos = 0

  // Monotonic deque (increasing values) for the sliding-window minimum.
  private val dqCap = window + 1
  private val dqValue = DoubleArray(dqCap)
  private val dqIndex = LongArray(dqCap)
  private var dqHead = 0
  private var dqSize = 0
  private var sampleIndex = 0L

  private val box = DoubleArray(window)
  private var boxPos = 0
  private var boxSum = 0.0
  private var smoothed = 1.0

  init {
    reset()
  }

  fun reset() {
    delayL.fill(0.0); delayR.fill(0.0); delayPos = 0
    dqHead = 0; dqSize = 0; sampleIndex = 0L
    box.fill(1.0); boxPos = 0; boxSum = window.toDouble()
    smoothed = 1.0
    blockMinGain = 1.0
  }

  /** Limits [l]/[r] in place; output is the input delayed by [delay] frames. */
  fun process(l: DoubleArray, r: DoubleArray, n: Int) {
    val stereo = channels == 2
    val w = window
    val ceil = ceiling
    val rel = release
    val on = enabled
    var minGain = 1.0
    for (i in 0 until n) {
      val xl = l[i]
      val xr = if (stereo) r[i] else xl
      val peak = max(abs(xl), abs(xr))
      val required = if (on && peak > ceil) ceil / peak else 1.0

      // Sliding minimum of the required gain over the last `window` samples.
      while (dqSize > 0) {
        val back = (dqHead + dqSize - 1) % dqCap
        if (dqValue[back] >= required) dqSize-- else break
      }
      val slot = (dqHead + dqSize) % dqCap
      dqValue[slot] = required
      dqIndex[slot] = sampleIndex
      dqSize++
      val expired = sampleIndex - w
      while (dqIndex[dqHead] <= expired) {
        dqHead = (dqHead + 1) % dqCap
        dqSize--
      }
      val minimum = dqValue[dqHead]

      // Instant attack to the minimum, smooth release, then a moving average.
      smoothed = if (minimum < smoothed) minimum else smoothed + (minimum - smoothed) * rel
      boxSum += smoothed - box[boxPos]
      box[boxPos] = smoothed
      boxPos++
      if (boxPos == w) {
        boxPos = 0
        var exact = 0.0
        for (v in box) exact += v
        boxSum = exact
      }
      val gain = (boxSum / w).coerceAtMost(1.0)
      if (gain < minGain) minGain = gain

      delayL[delayPos] = xl
      if (stereo) delayR[delayPos] = xr
      delayPos = if (delayPos + 1 == w) 0 else delayPos + 1
      l[i] = delayL[delayPos] * gain
      if (stereo) r[i] = delayR[delayPos] * gain
      sampleIndex++
    }
    blockMinGain = minGain
  }

  companion object {
    const val CEILING_DB = -0.3
    const val LOOKAHEAD_SEC = 0.0015
    const val RELEASE_SEC = 0.08
  }
}
