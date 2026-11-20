package expo.modules.thrumaudio.dsp

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sqrt

/** One visualizer frame, as sent to JS. */
class SpectrumFrame(val bands: FloatArray, val bass: Float, val peakDb: Float, val reductionDb: Float) {
  fun toMap(): Map<String, Any?> = mapOf(
    "bands" to bands.map { it.toDouble() },
    "bass" to bass.toDouble(),
    "peakDb" to peakDb.toDouble(),
    "reductionDb" to reductionDb.toDouble(),
  )
}

/**
 * Lock-free tap of the processed output. The audio thread appends mono samples to a ring; the UI
 * asks for a frame "as heard right now" by passing the output latency, so bars hit with the beat
 * even over Bluetooth.
 */
internal class SpectrumTap {
  // Writer side (audio thread only).
  private val ring = FloatArray(RING)
  private val bassRing = FloatArray(RING)
  private val bassFilter = BiquadCascade(2, 1)
  private val scratch = DoubleArray(DspChain.BLOCK)

  @Volatile private var written = 0L
  @Volatile private var lastWriteNs = 0L
  @Volatile private var sampleRate = 0

  fun configure(sr: Int) {
    if (sr == sampleRate) return
    Designs.lowPass(bassFilter.coefs[0], sr.toDouble(), BASS_HZ, 0.5411961)
    Designs.lowPass(bassFilter.coefs[1], sr.toDouble(), BASS_HZ, 1.3065630)
    bassFilter.reset()
    sampleRate = sr
  }

  fun write(l: DoubleArray, r: DoubleArray, n: Int, stereo: Boolean) {
    val start = written
    for (i in 0 until n) {
      val m = if (stereo) 0.5 * (l[i] + r[i]) else l[i]
      scratch[i] = m
      ring[((start + i) and MASK).toInt()] = m.toFloat()
    }
    bassFilter.process(scratch, n, 0)
    for (i in 0 until n) bassRing[((start + i) and MASK).toInt()] = scratch[i].toFloat()
    written = start + n
  }

  fun touch(nowNs: Long) {
    lastWriteNs = nowNs
  }

  // Reader side (serialized).
  private val fft = Fft(FFT_SIZE)
  private val window = Fft.hann(FFT_SIZE)
  private val re = DoubleArray(FFT_SIZE)
  private val im = DoubleArray(FFT_SIZE)
  private val power = DoubleArray(FFT_SIZE / 2 + 1)
  private val target = DoubleArray(BANDS)
  private val level = FloatArray(BANDS)
  private val bandLo = IntArray(BANDS)
  private val bandHi = IntArray(BANDS)
  private val bandCenter = DoubleArray(BANDS)
  private val bandTilt = DoubleArray(BANDS)
  private var mapRate = 0
  private var lastReadNs = 0L
  private var bassLevel = 0.0
  private var bassAvgDb = -30.0
  private var peakDb = -120.0

  @Synchronized
  fun read(delayFrames: Int, nowNs: Long, reductionDb: Float): SpectrumFrame? {
    val sr = sampleRate
    if (sr <= 0) return null
    if (mapRate != sr) buildMap(sr)
    val dt = if (lastReadNs == 0L) 1.0 / 60.0 else ((nowNs - lastReadNs) / 1e9).coerceIn(0.001, 0.1)
    lastReadNs = nowNs

    val delay = delayFrames.coerceIn(0, MAX_DELAY)
    val total = written
    val delayNs = delay * 1_000_000_000L / sr
    val live = total - delay >= FFT_SIZE && nowNs - lastWriteNs < STALE_NS + delayNs
    var bassTarget = 0.0
    if (live) {
      val end = total - delay
      analyze(end)
      bassTarget = bassPulse(end, dt)
    } else {
      target.fill(0.0)
      peakDb = max(-120.0, peakDb - 90.0 * dt)
    }

    val attack = 1.0 - exp(-dt / ATTACK_SEC)
    val release = 1.0 - exp(-dt / RELEASE_SEC)
    for (b in 0 until BANDS) {
      val t = target[b]
      val v = level[b].toDouble()
      level[b] = (v + (t - v) * if (t > v) attack else release).toFloat()
    }
    val bassK = if (bassTarget > bassLevel) 1.0 - exp(-dt / BASS_ATTACK_SEC) else 1.0 - exp(-dt / BASS_RELEASE_SEC)
    bassLevel += (bassTarget - bassLevel) * bassK
    return SpectrumFrame(level.copyOf(), bassLevel.toFloat(), peakDb.toFloat(), if (live) reductionDb else 0f)
  }

  private fun analyze(end: Long) {
    val start = end - FFT_SIZE
    var peak = 0.0
    for (i in 0 until FFT_SIZE) {
      val v = ring[((start + i) and MASK).toInt()].toDouble()
      if (i >= FFT_SIZE / 2) peak = max(peak, abs(v))
      re[i] = v * window[i]
      im[i] = 0.0
    }
    fft.forward(re, im)
    // A full-scale sine reads 0 dB in its bin (Hann coherent gain 0.5).
    val norm = (4.0 / FFT_SIZE).pow(2)
    for (k in 0..FFT_SIZE / 2) power[k] = (re[k] * re[k] + im[k] * im[k]) * norm
    for (b in 0 until BANDS) {
      val p = if (bandHi[b] >= bandLo[b]) {
        var sum = 0.0
        for (k in bandLo[b]..bandHi[b]) sum += power[k]
        sum / (bandHi[b] - bandLo[b] + 1)
      } else {
        interpolated(bandCenter[b])
      }
      val db = 10.0 * log10(p + 1e-14) + bandTilt[b]
      target[b] = ((db - DB_FLOOR) / (DB_CEIL - DB_FLOOR)).coerceIn(0.0, 1.0)
    }
    peakDb = 20.0 * log10(max(peak, 1e-6))
  }

  /** Kick/bass pulse: short-term bass level against its own slow average, gated by presence. */
  private fun bassPulse(end: Long, dt: Double): Double {
    var sum = 0.0
    for (i in 0 until BASS_WINDOW) {
      val v = bassRing[((end - BASS_WINDOW + i) and MASK).toInt()].toDouble()
      sum += v * v
    }
    val db = 10.0 * log10(sum / BASS_WINDOW + 1e-14)
    if (db > -70.0) bassAvgDb += (db - bassAvgDb) * (1.0 - exp(-dt / BASS_AVG_SEC))
    val relative = ((db - bassAvgDb + 4.0) / 10.0).coerceIn(0.0, 1.0)
    val presence = ((db + 50.0) / 20.0).coerceIn(0.0, 1.0)
    return relative * presence
  }

  private fun interpolated(bin: Double): Double {
    val nyquist = FFT_SIZE / 2
    if (bin >= nyquist) return 0.0
    val i0 = floor(bin).toInt().coerceAtLeast(0)
    val frac = bin - i0
    val i1 = (i0 + 1).coerceAtMost(nyquist)
    return power[i0] * (1.0 - frac) + power[i1] * frac
  }

  private fun buildMap(sr: Int) {
    val binHz = sr.toDouble() / FFT_SIZE
    val nyquist = FFT_SIZE / 2
    val ratio = HIGH_HZ / LOW_HZ
    for (b in 0 until BANDS) {
      val fLo = LOW_HZ * ratio.pow(b.toDouble() / BANDS)
      val fHi = LOW_HZ * ratio.pow((b + 1).toDouble() / BANDS)
      val center = sqrt(fLo * fHi)
      bandCenter[b] = center / binHz
      val lo = ceil(fLo / binHz).toInt()
      val hi = ceil(fHi / binHz).toInt() - 1
      if (hi - lo + 1 >= 2 && hi <= nyquist) {
        bandLo[b] = lo; bandHi[b] = hi
      } else {
        bandLo[b] = 1; bandHi[b] = 0
      }
      bandTilt[b] = TILT_DB_PER_OCTAVE * ln(center / 1000.0) / ln(2.0)
    }
    mapRate = sr
  }

  companion object {
    const val RING = 1 shl 16
    private const val MASK = (RING - 1).toLong()
    const val FFT_SIZE = 2048
    const val BANDS = 48
    private const val LOW_HZ = 30.0
    private const val HIGH_HZ = 16_000.0
    private const val BASS_HZ = 150.0
    private const val BASS_WINDOW = 1024
    private const val MAX_DELAY = RING - FFT_SIZE - 16_384
    private const val STALE_NS = 150_000_000L
    private const val DB_FLOOR = -72.0
    private const val DB_CEIL = -12.0
    private const val TILT_DB_PER_OCTAVE = 3.0
    private const val ATTACK_SEC = 0.025
    private const val RELEASE_SEC = 0.28
    private const val BASS_ATTACK_SEC = 0.012
    private const val BASS_RELEASE_SEC = 0.15
    private const val BASS_AVG_SEC = 2.0
  }
}
