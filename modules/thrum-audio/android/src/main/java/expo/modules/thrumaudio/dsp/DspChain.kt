package expo.modules.thrumaudio.dsp

import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.log10
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * The per-stream signal chain, processed in blocks of up to [BLOCK] frames (samples in -1..1):
 *
 * pre-gain -> rumble HPF -> bass shelf -> 10-band EQ -> treble shelf -> phantom bass -> width
 * -> balance -> lookahead limiter -> wet/dry crossfade with an equally delayed dry path.
 *
 * Every control is smoothed per block (filters are redesigned from smoothed values, gains ramp
 * per sample), so dragging a slider or toggling A/B never clicks. With the effect fully dry the
 * output is the untouched input, sample for sample.
 */
internal class DspChain(val sampleRate: Int, val channels: Int) {
  private val fs = sampleRate.toDouble()
  private val stereo = channels == 2

  private val eq = BiquadCascade(EqLayout.SECTIONS, channels)
  private val phantomIn = BiquadCascade(3, 1)
  private val phantomOut = BiquadCascade(2, 1)
  private val limiter = Limiter(sampleRate, channels)

  /** Frames of delay through the chain (identical for the wet and dry paths). */
  val latency: Int get() = limiter.delay

  /** True when the last block was fully dry, so the caller may emit the input bit-exactly. */
  var exactDry = false
    private set

  private val dryLine = Array(2) { DoubleArray(limiter.window) }
  private var dryPos = 0
  private val dryL = DoubleArray(BLOCK)
  private val dryR = DoubleArray(BLOCK)
  private val mono = DoubleArray(BLOCK)

  private var seenVersion = -1
  private var snapshot: DspEngine.Snapshot = DspEngine.snapshot

  // Smoothed controls and the values the filters were last designed for.
  private val bandDb = DoubleArray(SoundParams.BAND_COUNT)
  private val bandDesigned = DoubleArray(SoundParams.BAND_COUNT) { Double.NaN }
  private var bassDb = 0.0
  private var bassHz = 80.0
  private var bassDesigned = Double.NaN
  private var bassHzDesigned = Double.NaN
  private var trebleDb = 0.0
  private var trebleDesigned = Double.NaN
  private var rumbleHz = 0.0
  private var rumbleDesigned = Double.NaN
  private var pregainDb = 0.0
  private var pregain = 1.0
  private var phantom = 0.0
  private var width = 1.0
  private var balance = 0.0
  private var gainL = 1.0
  private var gainR = 1.0
  private var wet = 0.0

  private var envelope = 0.0
  private var sideLow = 0.0
  private var phantomActive = false
  private var cold = false
  private var reductionDb = 0.0

  private val sideCoef = exp(-2.0 * PI * SIDE_LOW_HZ / fs)
  private val envAttack = 1.0 - exp(-1.0 / (ENV_ATTACK_SEC * fs))
  private val envRelease = 1.0 - exp(-1.0 / (ENV_RELEASE_SEC * fs))
  private val wetStep = BLOCK / (WET_RAMP_SEC * fs)

  init {
    Designs.highPass(phantomIn.coefs[0], fs, PHANTOM_LOW_HZ, 0.7071)
    Designs.lowPass(phantomIn.coefs[1], fs, PHANTOM_HIGH_HZ, 0.5411961)
    Designs.lowPass(phantomIn.coefs[2], fs, PHANTOM_HIGH_HZ, 1.3065630)
    Designs.highPass(phantomOut.coefs[0], fs, HARMONIC_LOW_HZ, 0.7071)
    Designs.lowPass(phantomOut.coefs[1], fs, HARMONIC_HIGH_HZ, 0.7071)
    reset()
  }

  /** Clears all history and jumps straight to the current settings (stream start or seek). */
  fun reset() {
    eq.reset(); phantomIn.reset(); phantomOut.reset(); limiter.reset()
    for (line in dryLine) line.fill(0.0)
    dryPos = 0
    envelope = 0.0; sideLow = 0.0; phantomActive = false; cold = false
    reductionDb = 0.0
    snapshot = DspEngine.snapshot
    seenVersion = snapshot.version
    snapToTargets()
  }

  /** Processes [n] <= [BLOCK] frames of [l]/[r] in place. */
  fun process(l: DoubleArray, r: DoubleArray, n: Int) {
    val s = DspEngine.snapshot
    if (s.version != seenVersion) {
      snapshot = s
      seenVersion = s.version
    }
    val p = snapshot.params
    val wetTarget = if (p.enabled && !snapshot.bypass) 1.0 else 0.0

    for (i in 0 until n) {
      dryL[i] = l[i]
      if (stereo) dryR[i] = r[i]
    }

    val wetFrom = wet
    wet = if (wetTarget > wet) min(wetTarget, wet + wetStep) else maxOf(wetTarget, wet - wetStep)
    val idle = wetFrom == 0.0 && wet == 0.0 && !p.enabled
    if (idle) {
      // EQ switched off: skip the work, keep the timing.
      cold = true
      delayDry(n)
      for (i in 0 until n) {
        l[i] = dryL[i]
        if (stereo) r[i] = dryR[i]
      }
      exactDry = true
      DspEngine.tap.write(l, r, n, stereo)
      return
    }
    if (cold) {
      eq.reset(); phantomIn.reset(); phantomOut.reset(); limiter.reset()
      envelope = 0.0; sideLow = 0.0
      cold = false
    }

    smooth(p, n)
    limiter.enabled = p.limiter

    // Pre-gain (preamp + auto headroom), ramped across the block.
    val g0 = pregain
    val g1 = 10.0.pow(pregainDb / 20.0)
    pregain = g1
    val gStep = (g1 - g0) / n
    for (i in 0 until n) {
      val g = g0 + gStep * (i + 1)
      l[i] *= g
      if (stereo) r[i] *= g
    }

    eq.process(l, n, 0)
    if (stereo) eq.process(r, n, 1)

    applyPhantom(l, r, n, p)
    if (stereo) applyStereo(l, r, n, p)

    limiter.process(l, r, n)
    val blockReduction = -20.0 * log10(limiter.blockMinGain.coerceAtLeast(1e-6))
    reductionDb = maxOf(blockReduction, reductionDb - REDUCTION_DECAY_DB_PER_SEC * n / fs)
    DspEngine.reductionDb = reductionDb.toFloat()

    delayDry(n)
    val exact = wetFrom == 0.0 && wet == 0.0
    exactDry = exact
    if (exact) {
      for (i in 0 until n) {
        l[i] = dryL[i]
        if (stereo) r[i] = dryR[i]
      }
    } else if (wetFrom != 1.0 || wet != 1.0) {
      val step = (wet - wetFrom) / n
      for (i in 0 until n) {
        val w = wetFrom + step * (i + 1)
        l[i] = l[i] * w + dryL[i] * (1.0 - w)
        if (stereo) r[i] = r[i] * w + dryR[i] * (1.0 - w)
      }
    }
    DspEngine.tap.write(l, r, n, stereo)
  }

  private fun applyPhantom(l: DoubleArray, r: DoubleArray, n: Int, p: SoundParams) {
    val from = phantom
    val to = p.phantom * PHANTOM_GAIN
    phantom = approach(phantom, to, n, 1e-4)
    if (from == 0.0 && phantom == 0.0) {
      if (phantomActive) {
        phantomIn.reset(); phantomOut.reset(); envelope = 0.0
        phantomActive = false
      }
      return
    }
    phantomActive = true
    for (i in 0 until n) mono[i] = if (stereo) 0.5 * (l[i] + r[i]) else l[i]
    phantomIn.process(mono, n, 0)
    var env = envelope
    for (i in 0 until n) {
      val x = mono[i]
      val a = abs(x)
      env += (a - env) * if (a > env) envAttack else envRelease
      mono[i] = if (env < 1e-5) {
        0.0
      } else {
        // Chebyshev polynomials of a unit-level signal: Tn(cos t) = cos(n t), i.e. pure harmonics.
        val u = (x / env).coerceIn(-1.0, 1.0)
        val u2 = u * u
        val t2 = 2.0 * u2 - 1.0
        val t3 = u * (4.0 * u2 - 3.0)
        val t4 = 8.0 * u2 * (u2 - 1.0) + 1.0
        (H2 * t2 + H3 * t3 + H4 * t4) * env
      }
    }
    envelope = env
    phantomOut.process(mono, n, 0)
    val step = (phantom - from) / n
    for (i in 0 until n) {
      val add = mono[i] * (from + step * (i + 1))
      l[i] += add
      if (stereo) r[i] += add
    }
  }

  private fun applyStereo(l: DoubleArray, r: DoubleArray, n: Int, p: SoundParams) {
    val w0 = width
    width = approach(width, p.width.toDouble(), n, 1e-4)
    val w1 = width
    val wStep = (w1 - w0) / n
    var low = sideLow
    val k = sideCoef
    val shaping = w0 != 1.0 || w1 != 1.0
    for (i in 0 until n) {
      val side = 0.5 * (l[i] - r[i])
      low = low * k + (1.0 - k) * side
      if (shaping) {
        val w = w0 + wStep * (i + 1)
        val mid = 0.5 * (l[i] + r[i])
        // Narrowing scales everything; widening leaves the bass centred.
        val out = low * min(w, 1.0) + (side - low) * w
        l[i] = mid + out
        r[i] = mid - out
      }
    }
    sideLow = if (abs(low) < 1e-25) 0.0 else low

    val l0 = gainL
    val r0 = gainR
    balance = approach(balance, p.balance.toDouble(), n, 1e-4)
    val theta = (balance + 1.0) * PI / 4.0
    gainL = min(1.0, SQRT2 * cos(theta))
    gainR = min(1.0, SQRT2 * sin(theta))
    if (l0 == 1.0 && r0 == 1.0 && gainL == 1.0 && gainR == 1.0) return
    val lStep = (gainL - l0) / n
    val rStep = (gainR - r0) / n
    for (i in 0 until n) {
      l[i] *= l0 + lStep * (i + 1)
      r[i] *= r0 + rStep * (i + 1)
    }
  }

  private fun delayDry(n: Int) {
    val size = limiter.window
    val lineL = dryLine[0]
    val lineR = dryLine[1]
    var pos = dryPos
    for (i in 0 until n) {
      lineL[pos] = dryL[i]
      if (stereo) lineR[pos] = dryR[i]
      pos = if (pos + 1 == size) 0 else pos + 1
      dryL[i] = lineL[pos]
      if (stereo) dryR[i] = lineR[pos]
    }
    dryPos = pos
  }

  private fun snapToTargets() {
    val s = snapshot
    val p = s.params
    for (i in 0 until SoundParams.BAND_COUNT) bandDb[i] = p.bands[i].toDouble()
    bassDb = p.bassDb.toDouble()
    bassHz = p.bassFreq.toDouble()
    trebleDb = p.trebleDb.toDouble()
    rumbleHz = if (p.rumble) EqLayout.RUMBLE_HZ else 0.0
    pregainDb = targetPregainDb(s)
    pregain = 10.0.pow(pregainDb / 20.0)
    phantom = p.phantom * PHANTOM_GAIN
    width = p.width.toDouble()
    balance = p.balance.toDouble()
    val theta = (balance + 1.0) * PI / 4.0
    gainL = min(1.0, SQRT2 * cos(theta))
    gainR = min(1.0, SQRT2 * sin(theta))
    wet = if (p.enabled && !s.bypass) 1.0 else 0.0
    limiter.enabled = p.limiter
    bandDesigned.fill(Double.NaN)
    bassDesigned = Double.NaN; bassHzDesigned = Double.NaN
    trebleDesigned = Double.NaN; rumbleDesigned = Double.NaN
    redesign()
  }

  private fun smooth(p: SoundParams, n: Int) {
    for (i in 0 until SoundParams.BAND_COUNT) bandDb[i] = approach(bandDb[i], p.bands[i].toDouble(), n, 0.01)
    bassDb = approach(bassDb, p.bassDb.toDouble(), n, 0.01)
    bassHz = approach(bassHz, p.bassFreq.toDouble(), n, 0.05)
    trebleDb = approach(trebleDb, p.trebleDb.toDouble(), n, 0.01)
    val rumbleTarget = if (p.rumble) EqLayout.RUMBLE_HZ else 0.0
    rumbleHz = approach(rumbleHz, rumbleTarget, n, 0.05)
    if (rumbleTarget == 0.0 && rumbleHz < 3.0) rumbleHz = 0.0
    pregainDb = approach(pregainDb, targetPregainDb(snapshot), n, 0.01)
    redesign()
  }

  private fun redesign() {
    val c = eq.coefs
    if (rumbleHz != rumbleDesigned) {
      EqLayout.rumble(c[EqLayout.RUMBLE_A], c[EqLayout.RUMBLE_B], fs, rumbleHz)
      rumbleDesigned = rumbleHz
    }
    if (bassDb != bassDesigned || bassHz != bassHzDesigned) {
      EqLayout.bass(c[EqLayout.BASS], fs, bassDb, bassHz)
      bassDesigned = bassDb; bassHzDesigned = bassHz
    }
    for (i in 0 until SoundParams.BAND_COUNT) {
      if (bandDb[i] != bandDesigned[i]) {
        EqLayout.band(c[EqLayout.BAND0 + i], fs, i, bandDb[i])
        bandDesigned[i] = bandDb[i]
      }
    }
    if (trebleDb != trebleDesigned) {
      EqLayout.treble(c[EqLayout.TREBLE], fs, trebleDb)
      trebleDesigned = trebleDb
    }
  }

  /** One-pole glide toward [target] (time constant [PARAM_TAU_SEC]), snapping when close. */
  private fun approach(current: Double, target: Double, n: Int, epsilon: Double): Double {
    if (current == target) return target
    val k = 1.0 - exp(-n / (PARAM_TAU_SEC * fs))
    val next = current + (target - current) * k
    return if (abs(target - next) < epsilon) target else next
  }

  private fun targetPregainDb(s: DspEngine.Snapshot): Double =
    s.params.preampDb.toDouble() + s.headroomDb.toDouble()

  companion object {
    const val BLOCK = 64
    private const val PARAM_TAU_SEC = 0.03
    private const val WET_RAMP_SEC = 0.012
    private const val SIDE_LOW_HZ = 150.0
    private const val PHANTOM_LOW_HZ = 30.0
    private const val PHANTOM_HIGH_HZ = 120.0
    private const val HARMONIC_LOW_HZ = 80.0
    private const val HARMONIC_HIGH_HZ = 420.0
    private const val ENV_ATTACK_SEC = 0.005
    private const val ENV_RELEASE_SEC = 0.08
    private const val PHANTOM_GAIN = 0.8
    private const val H2 = 0.6
    private const val H3 = 0.35
    private const val H4 = 0.15
    private const val REDUCTION_DECAY_DB_PER_SEC = 20.0
    private val SQRT2 = sqrt(2.0)
  }
}
