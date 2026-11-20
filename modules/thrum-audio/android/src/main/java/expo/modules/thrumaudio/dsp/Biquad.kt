package expo.modules.thrumaudio.dsp

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/** Second-order section coefficients, normalized so a0 = 1. */
internal class Coefs {
  var b0 = 1.0
  var b1 = 0.0
  var b2 = 0.0
  var a1 = 0.0
  var a2 = 0.0

  /** True when the section is exactly a wire, so the cascade can skip it. */
  var identity = true
    private set

  fun setIdentity() {
    b0 = 1.0; b1 = 0.0; b2 = 0.0; a1 = 0.0; a2 = 0.0
    identity = true
  }

  fun set(nb0: Double, nb1: Double, nb2: Double, na0: Double, na1: Double, na2: Double) {
    val inv = 1.0 / na0
    b0 = nb0 * inv; b1 = nb1 * inv; b2 = nb2 * inv
    a1 = na1 * inv; a2 = na2 * inv
    identity = false
  }

  /** |H(e^jw)| in dB at [freq]. */
  fun magnitudeDb(freq: Double, sampleRate: Double): Double {
    if (identity) return 0.0
    val w = 2.0 * PI * freq / sampleRate
    val c1 = cos(w)
    val c2 = cos(2.0 * w)
    val num = b0 * b0 + b1 * b1 + b2 * b2 + 2.0 * (b0 * b1 + b1 * b2) * c1 + 2.0 * b0 * b2 * c2
    val den = 1.0 + a1 * a1 + a2 * a2 + 2.0 * (a1 + a1 * a2) * c1 + 2.0 * a2 * c2
    return 10.0 * log10(max(num, 1e-30) / max(den, 1e-30))
  }
}

/** Bilinear-transform filter designs (audio EQ cookbook formulas). */
internal object Designs {
  private fun clampFreq(f0: Double, fs: Double) = f0.coerceIn(1.0, 0.45 * fs)

  fun peaking(c: Coefs, fs: Double, f0: Double, gainDb: Double, q: Double) {
    val a = 10.0.pow(gainDb / 40.0)
    val w0 = 2.0 * PI * clampFreq(f0, fs) / fs
    val alpha = sin(w0) / (2.0 * q)
    val cw = cos(w0)
    c.set(1.0 + alpha * a, -2.0 * cw, 1.0 - alpha * a, 1.0 + alpha / a, -2.0 * cw, 1.0 - alpha / a)
  }

  fun lowShelf(c: Coefs, fs: Double, f0: Double, gainDb: Double, slope: Double = 1.0) {
    val a = 10.0.pow(gainDb / 40.0)
    val w0 = 2.0 * PI * clampFreq(f0, fs) / fs
    val cw = cos(w0)
    val alpha = sin(w0) / 2.0 * sqrt((a + 1.0 / a) * (1.0 / slope - 1.0) + 2.0)
    val k = 2.0 * sqrt(a) * alpha
    c.set(
      a * ((a + 1) - (a - 1) * cw + k),
      2 * a * ((a - 1) - (a + 1) * cw),
      a * ((a + 1) - (a - 1) * cw - k),
      (a + 1) + (a - 1) * cw + k,
      -2 * ((a - 1) + (a + 1) * cw),
      (a + 1) + (a - 1) * cw - k,
    )
  }

  fun highShelf(c: Coefs, fs: Double, f0: Double, gainDb: Double, slope: Double = 1.0) {
    val a = 10.0.pow(gainDb / 40.0)
    val w0 = 2.0 * PI * clampFreq(f0, fs) / fs
    val cw = cos(w0)
    val alpha = sin(w0) / 2.0 * sqrt((a + 1.0 / a) * (1.0 / slope - 1.0) + 2.0)
    val k = 2.0 * sqrt(a) * alpha
    c.set(
      a * ((a + 1) + (a - 1) * cw + k),
      -2 * a * ((a - 1) + (a + 1) * cw),
      a * ((a + 1) + (a - 1) * cw - k),
      (a + 1) - (a - 1) * cw + k,
      2 * ((a - 1) - (a + 1) * cw),
      (a + 1) - (a - 1) * cw - k,
    )
  }

  fun highPass(c: Coefs, fs: Double, f0: Double, q: Double) {
    val w0 = 2.0 * PI * clampFreq(f0, fs) / fs
    val cw = cos(w0)
    val alpha = sin(w0) / (2.0 * q)
    c.set((1 + cw) / 2, -(1 + cw), (1 + cw) / 2, 1 + alpha, -2 * cw, 1 - alpha)
  }

  fun lowPass(c: Coefs, fs: Double, f0: Double, q: Double) {
    val w0 = 2.0 * PI * clampFreq(f0, fs) / fs
    val cw = cos(w0)
    val alpha = sin(w0) / (2.0 * q)
    c.set((1 - cw) / 2, 1 - cw, (1 - cw) / 2, 1 + alpha, -2 * cw, 1 - alpha)
  }
}

/**
 * A chain of second-order sections in Direct Form I. DF1 keeps raw input/output history, so
 * coefficients can change between blocks without the state "meaning" something else (no clicks).
 */
internal class BiquadCascade(val sections: Int, private val channels: Int) {
  val coefs = Array(sections) { Coefs() }
  private val x1 = DoubleArray(sections * channels)
  private val x2 = DoubleArray(sections * channels)
  private val y1 = DoubleArray(sections * channels)
  private val y2 = DoubleArray(sections * channels)

  fun reset() {
    x1.fill(0.0); x2.fill(0.0); y1.fill(0.0); y2.fill(0.0)
  }

  /** Filters [buf] in place through every section for channel [ch]. */
  fun process(buf: DoubleArray, n: Int, ch: Int) {
    if (n <= 0) return
    for (s in 0 until sections) {
      val c = coefs[s]
      val k = s * channels + ch
      if (c.identity) {
        // A wire: keep history in step so switching the section on later is seamless.
        if (n >= 2) {
          x2[k] = buf[n - 2]; x1[k] = buf[n - 1]
        } else {
          x2[k] = x1[k]; x1[k] = buf[0]
        }
        y1[k] = x1[k]; y2[k] = x2[k]
        continue
      }
      val b0 = c.b0; val b1 = c.b1; val b2 = c.b2; val a1 = c.a1; val a2 = c.a2
      var sx1 = x1[k]; var sx2 = x2[k]; var sy1 = y1[k]; var sy2 = y2[k]
      for (i in 0 until n) {
        val x = buf[i]
        val y = b0 * x + b1 * sx1 + b2 * sx2 - a1 * sy1 - a2 * sy2
        sx2 = sx1; sx1 = x
        sy2 = sy1; sy1 = y
        buf[i] = y
      }
      // Decaying tails end in subnormals, which are slow on some cores.
      if (abs(sy1) < DENORMAL) sy1 = 0.0
      if (abs(sy2) < DENORMAL) sy2 = 0.0
      if (abs(sx1) < DENORMAL) sx1 = 0.0
      if (abs(sx2) < DENORMAL) sx2 = 0.0
      x1[k] = sx1; x2[k] = sx2; y1[k] = sy1; y2[k] = sy2
    }
  }

  fun responseDb(freq: Double, sampleRate: Double): Double {
    var sum = 0.0
    for (c in coefs) sum += c.magnitudeDb(freq, sampleRate)
    return sum
  }

  private companion object {
    const val DENORMAL = 1e-25
  }
}

/**
 * Where each tone control lives in the EQ cascade, and how it is designed. Shared by the audio
 * path (with smoothed values) and the headroom/response maths (with target values).
 */
internal object EqLayout {
  const val SECTIONS = 14
  const val RUMBLE_A = 0
  const val RUMBLE_B = 1
  const val BASS = 2
  const val BAND0 = 3
  const val TREBLE = 13

  const val RUMBLE_HZ = 22.0
  const val TREBLE_HZ = 7000.0
  const val BAND_Q = 1.41

  // 4th-order Butterworth high-pass split into two sections.
  private const val RUMBLE_Q1 = 0.5411961
  private const val RUMBLE_Q2 = 1.3065630

  fun rumble(a: Coefs, b: Coefs, fs: Double, hz: Double) {
    if (hz <= 0.0) {
      a.setIdentity(); b.setIdentity()
    } else {
      Designs.highPass(a, fs, hz, RUMBLE_Q1)
      Designs.highPass(b, fs, hz, RUMBLE_Q2)
    }
  }

  fun bass(c: Coefs, fs: Double, db: Double, hz: Double) {
    if (db == 0.0) c.setIdentity() else Designs.lowShelf(c, fs, hz, db)
  }

  fun band(c: Coefs, fs: Double, index: Int, db: Double) {
    val f = SoundParams.BAND_FREQS[index].toDouble()
    if (db == 0.0 || f > 0.45 * fs) c.setIdentity() else Designs.peaking(c, fs, f, db, BAND_Q)
  }

  fun treble(c: Coefs, fs: Double, db: Double) {
    if (db == 0.0) c.setIdentity() else Designs.highShelf(c, fs, TREBLE_HZ, db)
  }

  fun designAll(coefs: Array<Coefs>, fs: Double, p: SoundParams) {
    rumble(coefs[RUMBLE_A], coefs[RUMBLE_B], fs, if (p.rumble) RUMBLE_HZ else 0.0)
    bass(coefs[BASS], fs, p.bassDb.toDouble(), p.bassFreq.toDouble())
    for (i in 0 until SoundParams.BAND_COUNT) band(coefs[BAND0 + i], fs, i, p.bands[i].toDouble())
    treble(coefs[TREBLE], fs, p.trebleDb.toDouble())
  }

  /** Combined EQ response of [p] in dB at [freq]. */
  fun responseDb(p: SoundParams, freq: Double, fs: Double = 48_000.0): Double {
    val coefs = Array(SECTIONS) { Coefs() }
    designAll(coefs, fs, p)
    var sum = 0.0
    for (c in coefs) sum += c.magnitudeDb(freq, fs)
    return sum
  }

  /** Largest boost anywhere in 20 Hz..20 kHz. */
  fun maxBoostDb(p: SoundParams, fs: Double = 48_000.0): Double {
    val coefs = Array(SECTIONS) { Coefs() }
    designAll(coefs, fs, p)
    var best = 0.0
    val points = 240
    val top = 20_000.0.coerceAtMost(0.45 * fs)
    val ratio = top / 20.0
    for (i in 0..points) {
      val f = 20.0 * ratio.pow(i.toDouble() / points)
      var sum = 0.0
      for (c in coefs) sum += c.magnitudeDb(f, fs)
      if (sum > best) best = sum
    }
    return best
  }
}
