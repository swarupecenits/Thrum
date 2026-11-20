package expo.modules.thrumaudio.analysis

import expo.modules.thrumaudio.dsp.BiquadCascade
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

class FeatureExtractorTest {
  private fun analyze(
    rate: Int,
    seconds: Double,
    stereo: Boolean = true,
    maxSeconds: Double = seconds + 1.0,
    signal: (Double) -> Double,
  ): TrackFeatures? {
    val fx = FeatureExtractor(rate, maxSeconds)
    val total = (seconds * rate).toInt()
    val l = DoubleArray(4096)
    val r = DoubleArray(4096)
    var i = 0
    while (i < total) {
      val n = minOf(l.size, total - i)
      for (k in 0 until n) {
        l[k] = signal((i + k).toDouble() / rate)
        r[k] = l[k]
      }
      fx.push(l, if (stereo) r else null, n)
      i += n
    }
    return fx.finish()
  }

  private fun sine(freq: Double, amp: Double): (Double) -> Double = { t -> amp * sin(2 * PI * freq * t) }

  private fun midiHz(note: Int) = 440.0 * 2.0.pow((note - 69) / 12.0)

  private fun chords(progression: List<List<Int>>, secondsEach: Double): (Double) -> Double = { t ->
    val chord = progression[(t / secondsEach).toInt().coerceAtMost(progression.size - 1)]
    chord.sumOf { 0.2 * sin(2 * PI * midiHz(it) * t) }
  }

  /** Decaying noise bursts on every beat. */
  private fun clicks(bpm: Double): (Double) -> Double {
    val noise = Random(7)
    val period = 60.0 / bpm
    return { t ->
      val since = t % period
      if (since < 0.03) 0.6 * exp(-since / 0.006) * (noise.nextDouble() * 2 - 1) else 0.0
    }
  }

  @Test
  fun kWeightingReproducesTheBs1770Coefficients() {
    val c = BiquadCascade(2, 1)
    FeatureExtractor.kWeighting(c, 48_000.0)
    val shelf = c.coefs[0]
    assertEquals(1.53512485958697, shelf.b0, 1e-12)
    assertEquals(-2.69169618940638, shelf.b1, 1e-12)
    assertEquals(1.19839281085285, shelf.b2, 1e-12)
    assertEquals(-1.69065929318241, shelf.a1, 1e-12)
    assertEquals(0.73248077421585, shelf.a2, 1e-12)
    val rlb = c.coefs[1]
    assertEquals(1.0, rlb.b0, 1e-12)
    assertEquals(-2.0, rlb.b1, 1e-12)
    assertEquals(1.0, rlb.b2, 1e-12)
    assertEquals(-1.99004745483398, rlb.a1, 1e-12)
    assertEquals(0.99007225036621, rlb.a2, 1e-12)
  }

  @Test
  fun sineAtMinus20DbfsReadsMinus20Lufs() {
    // EBU Tech 3341: a stereo 1 kHz sine with -20 dBFS peaks in both channels is -20 LUFS.
    val stereo = analyze(44_100, 10.0, signal = sine(1_000.0, 0.1))!!
    assertEquals(-20.0, stereo.loudnessLufs, 0.1)
    assertEquals(0.1, stereo.peak, 1e-3)
    assertEquals(0.0, stereo.dynamics, 0.02)
    // Mono plays through both speakers, so it is measured as dual mono.
    val mono = analyze(48_000, 10.0, stereo = false, signal = sine(1_000.0, 0.1))!!
    assertEquals(-20.0, mono.loudnessLufs, 0.1)
  }

  @Test
  fun loudnessRangeSeesTheQuietHalf() {
    // EBU Tech 3342 case 1: 20 s at -20 dBFS, then 20 s at -30 dBFS, spans 10 LU. With a low
    // peak-to-loudness ratio, dynamics is then 0.5 * (LRA - 2) / 12.
    val f = analyze(44_100, 40.0) { t -> (if (t < 20.0) 0.1 else 0.1 / 10.0.pow(0.5)) * sin(2 * PI * 1_000.0 * t) }!!
    assertEquals(0.5 * 8.0 / 12.0, f.dynamics, 0.03)
    assertEquals(-22.6, f.loudnessLufs, 0.15)
  }

  @Test
  fun clickTracksFindTheirTempo() {
    for (bpm in listOf(90.0, 120.0, 150.0)) {
      val f = analyze(44_100, 30.0, signal = clicks(bpm))!!
      assertEquals("tempo of a $bpm BPM click", bpm, f.bpm, 1.5)
      assertEquals("onsets of a $bpm BPM click", bpm / 60.0, f.onsetRate, 0.2)
      assertTrue("confidence of a $bpm BPM click: ${f.bpmConfidence}", f.bpmConfidence > 0.3)
    }
  }

  @Test
  fun chordProgressionsRevealTheirKey() {
    val cMajor = listOf(listOf(60, 64, 67), listOf(65, 69, 72), listOf(67, 71, 74), listOf(60, 64, 67))
    val c = analyze(44_100, 24.0, signal = chords(cMajor, 6.0))!!
    assertEquals(0, c.key)
    assertEquals(1, c.mode)
    assertTrue(c.keyConfidence > 0.5)

    val aMinor = listOf(listOf(57, 60, 64), listOf(62, 65, 69), listOf(64, 67, 71), listOf(57, 60, 64))
    val a = analyze(48_000, 24.0, signal = chords(aMinor, 6.0))!!
    assertEquals(9, a.key)
    assertEquals(0, a.mode)
  }

  @Test
  fun bassSharesFollowTheSpectrum() {
    val low = analyze(44_100, 10.0, signal = sine(50.0, 0.5))!!
    assertTrue("bass ${low.bass}", low.bass > 0.9)
    assertTrue("subBass ${low.subBass}", low.subBass > 0.9)
    val high = analyze(44_100, 10.0, signal = sine(2_000.0, 0.5))!!
    assertTrue("bass ${high.bass}", high.bass < 0.05)
    assertTrue("subBass ${high.subBass}", high.subBass < 0.05)
    assertTrue(high.brightness > low.brightness + 0.3)
  }

  @Test
  fun shortSilentAndBrokenInputStayWellBehaved() {
    assertNull(analyze(44_100, 2.5, signal = sine(440.0, 0.5)))

    val silent = analyze(44_100, 8.0) { 0.0 }
    assertNotNull(silent)
    silent!!
    assertEquals(-70.0, silent.loudnessLufs, 0.0)
    assertEquals(0.0, silent.bpm, 0.0)
    assertEquals(-1, silent.key)

    val broken = analyze(44_100, 8.0) { t -> if (t < 4.0) Double.NaN else 0.3 * sin(2 * PI * 440.0 * t) }!!
    for (f in listOf(silent, broken)) {
      val values = listOf(
        f.bpm, f.bpmConfidence, f.energy, f.loudnessLufs, f.peak, f.dynamics, f.bass, f.subBass, f.brightness,
        f.flatness, f.danceability, f.valence, f.acousticness, f.keyConfidence, f.onsetRate,
      )
      assertTrue(values.toString(), values.all { it.isFinite() })
      for (v in listOf(f.energy, f.dynamics, f.bass, f.danceability, f.valence, f.acousticness)) assertTrue(v in 0.0..1.0)
    }
    assertEquals(0.3, broken.peak, 1e-3)
  }

  @Test
  fun inputStopsAtTheWindow() {
    val fx = FeatureExtractor(48_000, 4.0)
    val second = DoubleArray(48_000) { 0.25 * sin(2 * PI * 220.0 * it / 48_000.0) }
    repeat(3) { assertTrue(fx.push(second, null, second.size)) }
    assertFalse(fx.push(second, null, second.size))
    assertTrue(fx.full)
    assertFalse(fx.push(second, null, second.size))
    assertNotNull(fx.finish())
  }
}
