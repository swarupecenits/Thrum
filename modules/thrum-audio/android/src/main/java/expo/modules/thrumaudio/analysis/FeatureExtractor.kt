package expo.modules.thrumaudio.analysis

import expo.modules.thrumaudio.dsp.BiquadCascade
import expo.modules.thrumaudio.dsp.Designs
import expo.modules.thrumaudio.dsp.Fft
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.ln
import kotlin.math.log10
import kotlin.math.log2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sqrt
import kotlin.math.tan

/**
 * Measures a stretch of decoded audio. Feed blocks with [push], then call [finish] once.
 * Pure Kotlin (no Android types), so the maths is unit-tested on the JVM.
 *
 * - Loudness: ITU-R BS.1770 K-weighting with gated 400 ms blocks; loudness range per EBU Tech 3342.
 * - Rhythm: spectral-flux onsets, autocorrelation scored by a harmonic comb with a soft 120 BPM prior.
 * - Tonality: a five-octave chroma matched against the Krumhansl–Schmuckler key profiles.
 * - Perceptual scores (energy, danceability, valence, acousticness) are documented blends of those
 *   measurements, tuned for ranking songs against each other rather than as absolute truths.
 */
internal class FeatureExtractor(val sampleRate: Int, maxSeconds: Double) {
  private val fs = sampleRate.toDouble()
  private val maxFrames = max(1L, (maxSeconds * fs).toLong())
  private var framesIn = 0L
  private var peak = 0.0

  private val kWeight = BiquadCascade(2, 2).also { kWeighting(it, fs) }
  private val subLen = max(1, (fs * SUB_BLOCK_S).roundToInt())
  private var subSum = 0.0
  private var subCount = 0
  private var subBlocks = DoubleArray(ceil(maxSeconds / SUB_BLOCK_S).toInt() + 2)
  private var subN = 0

  /** The rhythm/tone passes run on a mono copy decimated to about 22 kHz. */
  val decimation = max(1, (fs / TARGET_RATE).roundToInt())
  val analysisRate = fs / decimation
  private val antiAlias = if (decimation > 1) {
    BiquadCascade(3, 1).also {
      for (s in 0 until 3) Designs.lowPass(it.coefs[s], fs, ALIAS_CUTOFF * analysisRate, BUTTERWORTH6_Q[s])
    }
  } else {
    null
  }
  private var phase = 0
  private val dcCoef = exp(-2.0 * PI * DC_HZ / analysisRate)
  private var dcIn = 0.0
  private var dcOut = 0.0
  private val mono = FloatArray((maxFrames / decimation + 2).toInt())
  private var monoN = 0

  private var bufL = DoubleArray(0)
  private var bufR = DoubleArray(0)
  private var bufM = DoubleArray(0)

  /** True once `maxSeconds` of audio has arrived; further input is ignored. */
  val full: Boolean get() = framesIn >= maxFrames

  /** Adds [n] frames in -1..1. [right] is null for mono. Returns false once [full]. */
  fun push(left: DoubleArray, right: DoubleArray?, n: Int): Boolean {
    val count = min(n.toLong(), maxFrames - framesIn).toInt()
    if (count <= 0) return false
    if (bufL.size < count) {
      bufL = DoubleArray(count)
      bufR = DoubleArray(count)
      bufM = DoubleArray(count)
    }
    var pk = peak
    for (i in 0 until count) {
      val l = clean(left[i])
      val r = if (right != null) clean(right[i]) else l
      bufL[i] = l
      bufR[i] = r
      bufM[i] = 0.5 * (l + r)
      if (abs(l) > pk) pk = abs(l)
      if (abs(r) > pk) pk = abs(r)
    }
    peak = pk
    accumulateLoudness(count, right != null)
    decimate(count)
    framesIn += count
    return !full
  }

  /** Null when less than three seconds of audio arrived. */
  fun finish(): TrackFeatures? {
    if (framesIn < MIN_SECONDS * fs) return null
    val lufs = integratedLoudness()
    val lra = loudnessRange()
    val peakDb = if (peak > 1e-9) 20.0 * log10(peak) else -180.0
    val rhythm = rhythmPass()
    val tonal = tonalPass()
    val tempo = tempo(rhythm.onset, rhythm.fps)
    val key = key(tonal.chroma)

    val bass = clamp01((tonal.share150 - 0.15) / 0.55)
    val subBass = clamp01((tonal.share60 - 0.03) / 0.37)
    val dynamics = clamp01(0.5 * clamp01((lra - 2.0) / 12.0) + 0.5 * clamp01((peakDb - lufs - 6.0) / 14.0))
    val loudN = clamp01((lufs + 30.0) / 24.0)
    val onsetN = clamp01(tempo.onsetRate / 6.0)
    val bright = rhythm.brightness
    val flat = rhythm.flatness

    val energy = clamp01(0.45 * loudN + 0.2 * onsetN + 0.15 * bright + 0.1 * flat + 0.1 * (1 - dynamics))
    val tempoFit = if (tempo.bpm > 0) {
      var folded = tempo.bpm
      while (folded < 80.0) folded *= 2.0
      while (folded >= 160.0) folded /= 2.0
      val o = log2(folded / 118.0) / 0.3
      exp(-0.5 * o * o)
    } else {
      0.0
    }
    val dance = clamp01(0.4 * tempo.confidence + 0.25 * tempoFit + 0.2 * bass + 0.15 * (1 - dynamics))
    val tempoN = if (tempo.bpm > 0) clamp01((tempo.bpm - 60.0) / 110.0) else 0.5
    val modeTerm = when {
      key.tonic < 0 -> 0.0
      key.mode == 1 -> key.confidence
      else -> -key.confidence
    }
    val valence = clamp01(
      0.5 + 0.22 * modeTerm + 0.18 * (bright - 0.5) + 0.15 * (tempoN - 0.5) +
        0.15 * (energy - 0.5) + 0.1 * (dance - 0.5),
    )
    val acoustic = clamp01(
      0.3 * dynamics + 0.25 * (1 - subBass) + 0.2 * (1 - flat) + 0.15 * (1 - loudN) + 0.1 * (1 - onsetN),
    )

    return TrackFeatures(
      bpm = tempo.bpm,
      bpmConfidence = tempo.confidence,
      energy = energy,
      loudnessLufs = lufs,
      peak = peak.coerceAtMost(1.0),
      dynamics = dynamics,
      bass = bass,
      subBass = subBass,
      brightness = bright,
      flatness = flat,
      danceability = dance,
      valence = valence,
      acousticness = acoustic,
      key = key.tonic,
      mode = key.mode,
      keyConfidence = key.confidence,
      onsetRate = tempo.onsetRate,
    )
  }

  // region streaming

  private fun accumulateLoudness(count: Int, stereo: Boolean) {
    kWeight.process(bufL, count, 0)
    if (stereo) kWeight.process(bufR, count, 1)
    var i = 0
    while (i < count) {
      val take = min(count - i, subLen - subCount)
      var s = 0.0
      if (stereo) {
        for (j in i until i + take) s += bufL[j] * bufL[j] + bufR[j] * bufR[j]
      } else {
        // Mono counts as dual-mono, so it reads like the same mix played on two speakers.
        for (j in i until i + take) s += 2.0 * bufL[j] * bufL[j]
      }
      subSum += s
      subCount += take
      i += take
      if (subCount == subLen) {
        if (subN == subBlocks.size) subBlocks = subBlocks.copyOf(subN * 2)
        subBlocks[subN++] = subSum / subLen
        subSum = 0.0
        subCount = 0
      }
    }
  }

  private fun decimate(count: Int) {
    antiAlias?.process(bufM, count, 0)
    for (j in 0 until count) {
      if (phase == 0 && monoN < mono.size) {
        val x = bufM[j]
        val y = x - dcIn + dcCoef * dcOut
        dcIn = x
        dcOut = y
        mono[monoN++] = y.toFloat()
      }
      if (++phase == decimation) phase = 0
    }
  }

  // endregion

  // region loudness

  /** Mean power of every run of [width] consecutive 100 ms sub-blocks. */
  private fun windows(width: Int): DoubleArray {
    if (subN < width) return DoubleArray(0)
    return DoubleArray(subN - width + 1) { start ->
      var s = 0.0
      for (i in start until start + width) s += subBlocks[i]
      s / width
    }
  }

  private fun integratedLoudness(): Double {
    val blocks = windows(4)
    var sum = 0.0
    var n = 0
    for (z in blocks) if (lufsOf(z) > ABS_GATE) { sum += z; n++ }
    if (n == 0) return SILENCE_LUFS
    val relative = lufsOf(sum / n) - 10.0
    sum = 0.0
    n = 0
    for (z in blocks) {
      val l = lufsOf(z)
      if (l > ABS_GATE && l > relative) { sum += z; n++ }
    }
    return if (n == 0) SILENCE_LUFS else lufsOf(sum / n)
  }

  private fun loudnessRange(): Double {
    val short = windows(30)
    var sum = 0.0
    var n = 0
    for (z in short) if (lufsOf(z) > ABS_GATE) { sum += z; n++ }
    if (n == 0) return 0.0
    val relative = lufsOf(sum / n) - 20.0
    val kept = short.map(::lufsOf).filter { it > ABS_GATE && it > relative }.sorted()
    if (kept.size < 2) return 0.0
    return percentile(kept, 0.95) - percentile(kept, 0.10)
  }

  // endregion

  // region spectra

  private class Rhythm(val onset: DoubleArray, val fps: Double, val brightness: Double, val flatness: Double)

  /** ~46 ms frames at ~86 fps: onset envelope, spectral centroid and flatness. */
  private fun rhythmPass(): Rhythm {
    val size = nearestPow2(0.046 * analysisRate).coerceIn(256, 4096)
    val hop = size / 4
    val fps = analysisRate / hop
    val frames = if (monoN >= size) 1 + (monoN - size) / hop else 0
    val onset = DoubleArray(frames)
    if (frames == 0) return Rhythm(onset, fps, 0.0, 0.0)
    val fft = Fft(size)
    val window = Fft.hann(size)
    val re = DoubleArray(size)
    val im = DoubleArray(size)
    val binHz = analysisRate / size
    val lo = max(1, ceil(LOW_HZ / binHz).toInt())
    val hi = min(size / 2 - 1, floor(HIGH_HZ / binHz).toInt())
    val bins = hi - lo + 1
    val prev = DoubleArray(hi + 1)
    val meanMag = DoubleArray(hi + 1)
    val norm = 4.0 / size
    var voiced = 0
    var flatLog = 0.0
    for (t in 0 until frames) {
      val loud = frame(t * hop, size, window, re, im, fft)
      var flux = 0.0
      var pSum = 0.0
      var logSum = 0.0
      for (k in lo..hi) {
        val m = sqrt(re[k] * re[k] + im[k] * im[k]) * norm
        val c = ln(1.0 + ONSET_GAMMA * m)
        if (t > 0 && c > prev[k]) flux += c - prev[k]
        prev[k] = c
        if (loud) {
          meanMag[k] += m
          val p = m * m + 1e-12
          pSum += p
          logSum += ln(p)
        }
      }
      onset[t] = flux
      if (loud) {
        voiced++
        flatLog += logSum / bins / LN10 - log10(pSum / bins)
      }
    }
    if (voiced == 0) return Rhythm(onset, fps, 0.0, 0.0)
    var weighted = 0.0
    var total = 0.0
    for (k in lo..hi) {
      weighted += k * binHz * meanMag[k]
      total += meanMag[k]
    }
    val centroid = if (total > 0) weighted / total else 0.0
    val brightness = if (centroid > 0) clamp01(log2(centroid / 500.0) / 3.0) else 0.0
    val flatness = clamp01((flatLog / voiced + 2.5) / 2.5)
    return Rhythm(onset, fps, brightness, flatness)
  }

  private class Tonal(val share60: Double, val share150: Double, val chroma: DoubleArray)

  /** ~370 ms frames: low-frequency energy shares and the pitch-class profile. */
  private fun tonalPass(): Tonal {
    val size = nearestPow2(0.37 * analysisRate).coerceIn(1024, 16384)
    val hop = size / 2
    val frames = if (monoN >= size) 1 + (monoN - size) / hop else 0
    val chroma = DoubleArray(12)
    if (frames == 0) return Tonal(0.0, 0.0, chroma)
    val fft = Fft(size)
    val window = Fft.hann(size)
    val re = DoubleArray(size)
    val im = DoubleArray(size)
    val half = size / 2
    val binHz = analysisRate / size
    val kLow = max(1, ceil(LOW_HZ / binHz).toInt())
    val k60 = ceil(SUB_HZ / binHz).toInt()
    val k150 = ceil(BASS_HZ / binHz).toInt()
    val kHigh = min(half - 1, ceil(HIGH_HZ / binHz).toInt() - 1)

    // Each semitone takes the strongest bin within a quarter-tone, so every pitch class weighs the
    // same however many FFT bins its octaves span.
    val notes = CHROMA_LAST - CHROMA_FIRST + 1
    val noteLo = IntArray(notes)
    val noteHi = IntArray(notes)
    for (s in 0 until notes) {
      val f = 440.0 * 2.0.pow((CHROMA_FIRST + s - 69) / 12.0)
      var a = ceil(f * SEMI_DOWN / binHz).toInt()
      var b = floor(f * SEMI_UP / binHz).toInt()
      if (a > b) {
        a = (f / binHz).roundToInt()
        b = a
      }
      noteLo[s] = a.coerceIn(1, half - 1)
      noteHi[s] = b.coerceIn(1, half - 1)
    }
    val top = max(kHigh, noteHi[notes - 1])
    val mag = DoubleArray(top + 1)
    val norm = 4.0 / size
    val frameChroma = DoubleArray(12)
    var sub = 0.0
    var low = 0.0
    var total = 0.0
    for (t in 0 until frames) {
      if (!frame(t * hop, size, window, re, im, fft)) continue
      for (k in 1..top) mag[k] = sqrt(re[k] * re[k] + im[k] * im[k]) * norm
      for (k in kLow..kHigh) {
        val p = mag[k] * mag[k]
        total += p
        if (k < k150) low += p
        if (k < k60) sub += p
      }
      frameChroma.fill(0.0)
      for (s in 0 until notes) {
        var m = 0.0
        for (k in noteLo[s]..noteHi[s]) if (mag[k] > m) m = mag[k]
        frameChroma[(CHROMA_FIRST + s) % 12] += ln(1.0 + CHROMA_GAMMA * m)
      }
      var peakPc = 0.0
      for (v in frameChroma) if (v > peakPc) peakPc = v
      if (peakPc > 0) for (pc in 0 until 12) chroma[pc] += frameChroma[pc] / peakPc
    }
    return if (total > 0) Tonal(sub / total, low / total, chroma) else Tonal(0.0, 0.0, chroma)
  }

  /** Windows one frame into re/im and transforms it. Returns whether the frame is above the gate. */
  private fun frame(offset: Int, size: Int, window: DoubleArray, re: DoubleArray, im: DoubleArray, fft: Fft): Boolean {
    var energy = 0.0
    for (i in 0 until size) {
      val x = mono[offset + i].toDouble()
      energy += x * x
      re[i] = x * window[i]
      im[i] = 0.0
    }
    fft.forward(re, im)
    return energy / size >= GATE_POWER
  }

  // endregion

  // region tempo & key

  private class Tempo(val bpm: Double, val confidence: Double, val onsetRate: Double)

  private fun tempo(onset: DoubleArray, fps: Double): Tempo {
    val n = onset.size
    if (n < MIN_SECONDS * fps) return Tempo(0.0, 0.0, 0.0)

    // Remove the local level (1 s centred mean) and keep only the rises.
    val prefix = DoubleArray(n + 1)
    for (i in 0 until n) prefix[i + 1] = prefix[i] + onset[i]
    val half = max(1, (0.5 * fps).roundToInt())
    val env = DoubleArray(n)
    for (t in 0 until n) {
      val a = max(0, t - half)
      val b = min(n, t + half + 1)
      env[t] = max(0.0, onset[t] - (prefix[b] - prefix[a]) / (b - a))
    }
    var mean = 0.0
    for (v in env) mean += v
    mean /= n
    var variance = 0.0
    for (v in env) variance += (v - mean) * (v - mean)
    variance /= n
    if (variance <= 1e-18) return Tempo(0.0, 0.0, 0.0)

    val threshold = mean + 0.5 * sqrt(variance)
    val minGap = max(1, ceil(MIN_ONSET_GAP_S * fps).toInt())
    var onsets = 0
    var last = -minGap
    for (t in 1 until n - 1) {
      val v = env[t]
      if (v > threshold && v > env[t - 1] && v >= env[t + 1] && t - last >= minGap) {
        onsets++
        last = t
      }
    }
    val onsetRate = onsets / (n / fps)

    val minLag = max(2, floor(60.0 * fps / MAX_BPM).toInt())
    val maxLag = ceil(60.0 * fps / MIN_BPM).toInt()
    val acLen = min(n / 2, 4 * maxLag + 2)
    if (acLen <= minLag + 2) return Tempo(0.0, 0.0, onsetRate)
    val ac = DoubleArray(acLen + 1)
    for (lag in 0..acLen) {
      var s = 0.0
      for (t in 0 until n - lag) s += (env[t] - mean) * (env[t + lag] - mean)
      ac[lag] = s / (n - lag)
    }
    val zero = ac[0]
    for (lag in 0..acLen) ac[lag] /= zero

    // A beat period also repeats at 2x, 3x and 4x; scoring the whole comb rejects double-time
    // answers, and the soft prior settles the remaining half/double ambiguity.
    var bestLag = -1
    var bestScore = 0.0
    for (lag in minLag..min(maxLag, acLen - 1)) {
      var s = 0.0
      var w = 0.0
      for (m in 1..4) {
        val c = m * lag
        val r = m / 2
        if (c + r > acLen) break
        s += ac[argMax(ac, c - r, c + r)] / m
        w += 1.0 / m
      }
      if (w == 0.0) continue
      val octaves = log2(60.0 * fps / lag / PRIOR_BPM) / PRIOR_OCTAVES
      val score = max(0.0, s / w) * exp(-0.5 * octaves * octaves)
      if (score > bestScore) {
        bestScore = score
        bestLag = lag
      }
    }
    if (bestLag < 0) return Tempo(0.0, 0.0, onsetRate)

    // Refine on the furthest clean multiple (sub-frame precision grows with m).
    var period = bestLag.toDouble()
    for (m in 4 downTo 1) {
      val c = m * bestLag
      val lo = max(1, c - m / 2 - 1)
      val hi = min(acLen - 1, c + m / 2 + 1)
      if (lo > hi) continue
      val j = argMax(ac, lo, hi)
      if (ac[j] <= 0.0 || ac[j] < ac[j - 1] || ac[j] < ac[j + 1]) continue
      val denom = ac[j - 1] - 2.0 * ac[j] + ac[j + 1]
      val delta = if (denom < 0.0) (0.5 * (ac[j - 1] - ac[j + 1]) / denom).coerceIn(-0.5, 0.5) else 0.0
      period = (j + delta) / m
      break
    }
    val strength = ac[argMax(ac, max(1, bestLag - 1), min(acLen, bestLag + 1))]
    val bpm = (60.0 * fps / period).coerceIn(MIN_BPM, MAX_BPM)
    return Tempo(bpm, clamp01((strength - 0.05) / 0.5), onsetRate)
  }

  private class Key(val tonic: Int, val mode: Int, val confidence: Double)

  private fun key(chroma: DoubleArray): Key {
    val mean = chroma.average()
    var variance = 0.0
    for (c in chroma) variance += (c - mean) * (c - mean)
    if (variance <= 1e-9 * max(1.0, mean * mean)) return Key(-1, 1, 0.0)
    var best = -2.0
    var bestTonic = -1
    var bestMode = 1
    for (mode in 0..1) {
      val profile = if (mode == 1) MAJOR else MINOR
      val pm = profile.average()
      var pv = 0.0
      for (p in profile) pv += (p - pm) * (p - pm)
      for (tonic in 0 until 12) {
        var cov = 0.0
        for (pc in 0 until 12) cov += (chroma[pc] - mean) * (profile[(pc - tonic + 12) % 12] - pm)
        val r = cov / sqrt(variance * pv)
        if (r > best) {
          best = r
          bestTonic = tonic
          bestMode = mode
        }
      }
    }
    val confidence = clamp01((best - 0.3) / 0.6)
    return Key(if (confidence < 0.05) -1 else bestTonic, bestMode, confidence)
  }

  // endregion

  internal companion object {
    private const val SUB_BLOCK_S = 0.1
    private const val MIN_SECONDS = 3.0
    private const val TARGET_RATE = 22_050.0
    private const val ALIAS_CUTOFF = 0.38
    private val BUTTERWORTH6_Q = doubleArrayOf(0.5176381, 0.7071068, 1.9318517)
    private const val DC_HZ = 10.0
    private const val GATE_POWER = 1e-6
    private const val ABS_GATE = -70.0
    private const val SILENCE_LUFS = -70.0
    private const val LOW_HZ = 20.0
    private const val SUB_HZ = 60.0
    private const val BASS_HZ = 150.0
    private const val HIGH_HZ = 8_000.0
    private const val ONSET_GAMMA = 1000.0
    private const val CHROMA_GAMMA = 100.0
    private const val CHROMA_FIRST = 45 // A2, five whole octaves up to G#7
    private const val CHROMA_LAST = 104
    private val SEMI_UP = 2.0.pow(1.0 / 24.0)
    private val SEMI_DOWN = 1.0 / SEMI_UP
    private const val MIN_BPM = 60.0
    private const val MAX_BPM = 200.0
    private const val PRIOR_BPM = 120.0
    private const val PRIOR_OCTAVES = 1.0
    private const val MIN_ONSET_GAP_S = 0.05
    private val LN10 = ln(10.0)

    // Krumhansl & Kessler probe-tone ratings, tonic first.
    private val MAJOR = doubleArrayOf(6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88)
    private val MINOR = doubleArrayOf(6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17)

    /**
     * BS.1770 K-weighting at any rate: a +4 dB high shelf (head acoustics) followed by the RLB
     * high-pass. The analog-prototype constants reproduce the standard's 48 kHz coefficients.
     */
    fun kWeighting(c: BiquadCascade, fs: Double) {
      val k1 = tan(PI * 1681.974450955533 / fs)
      val q1 = 0.7071752369554196
      val vh = 10.0.pow(3.999843853973347 / 20.0)
      val vb = vh.pow(0.4996667741545416)
      c.coefs[0].set(
        vh + vb * k1 / q1 + k1 * k1,
        2.0 * (k1 * k1 - vh),
        vh - vb * k1 / q1 + k1 * k1,
        1.0 + k1 / q1 + k1 * k1,
        2.0 * (k1 * k1 - 1.0),
        1.0 - k1 / q1 + k1 * k1,
      )
      val k2 = tan(PI * 38.13547087602444 / fs)
      val q2 = 0.5003270373238773
      val a0 = 1.0 + k2 / q2 + k2 * k2
      // The standard leaves this stage's numerator un-normalized (1, -2, 1).
      c.coefs[1].set(a0, -2.0 * a0, a0, a0, 2.0 * (k2 * k2 - 1.0), 1.0 - k2 / q2 + k2 * k2)
    }

    private fun lufsOf(power: Double) = if (power > 0) -0.691 + 10.0 * log10(power) else Double.NEGATIVE_INFINITY

    private fun percentile(sorted: List<Double>, p: Double): Double {
      val x = p * (sorted.size - 1)
      val i = floor(x).toInt()
      val f = x - i
      return if (i + 1 < sorted.size) sorted[i] * (1 - f) + sorted[i + 1] * f else sorted[i]
    }

    private fun nearestPow2(x: Double): Int {
      var p = 1
      while (p * 2 <= x) p *= 2
      return if (x - p <= 2 * p - x) p else 2 * p
    }

    private fun argMax(a: DoubleArray, from: Int, to: Int): Int {
      var best = from
      for (i in from + 1..to) if (a[i] > a[best]) best = i
      return best
    }

    private fun clean(x: Double) = if (x.isFinite()) x else 0.0

    private fun clamp01(x: Double) = if (x.isNaN()) 0.0 else x.coerceIn(0.0, 1.0)
  }
}
