package expo.modules.thrumaudio.dsp

import androidx.media3.common.C
import androidx.media3.common.audio.AudioProcessor
import androidx.media3.common.audio.AudioProcessor.AudioFormat
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.hypot
import kotlin.math.pow
import kotlin.math.sin
import kotlin.math.sqrt
import kotlin.random.Random

class DspTest {
  @After
  fun restore() {
    DspEngine.setBypass(false)
    DspEngine.update(SoundParams.THRUM_DEFAULT)
  }

  @Test
  fun peakingHitsItsGainAtTheCentre() {
    val c = Coefs()
    Designs.peaking(c, 48_000.0, 1_000.0, 6.0, 1.41)
    assertEquals(6.0, c.magnitudeDb(1_000.0, 48_000.0), 0.01)
    assertEquals(0.0, c.magnitudeDb(20.0, 48_000.0), 0.1)
    assertEquals(0.0, c.magnitudeDb(20_000.0, 48_000.0), 0.2)
  }

  @Test
  fun shelvesAndRumbleShapeTheEnds() {
    val low = Coefs()
    Designs.lowShelf(low, 48_000.0, 80.0, 6.0)
    assertEquals(6.0, low.magnitudeDb(15.0, 48_000.0), 0.3)
    assertEquals(0.0, low.magnitudeDb(2_000.0, 48_000.0), 0.1)

    val a = Coefs()
    val b = Coefs()
    EqLayout.rumble(a, b, 48_000.0, EqLayout.RUMBLE_HZ)
    assertTrue(a.magnitudeDb(8.0, 48_000.0) + b.magnitudeDb(8.0, 48_000.0) < -24.0)
    assertTrue(a.magnitudeDb(100.0, 48_000.0) + b.magnitudeDb(100.0, 48_000.0) > -0.2)
  }

  @Test
  fun cascadeOutputMatchesTheDesignedResponse() {
    val fs = 48_000.0
    val cascade = BiquadCascade(1, 1)
    Designs.peaking(cascade.coefs[0], fs, 1_000.0, 6.0, 1.41)
    val n = 48_000
    val buf = DoubleArray(n) { 0.25 * sin(2 * PI * 1_000.0 * it / fs) }
    cascade.process(buf, n, 0)
    val tail = buf.copyOfRange(n / 2, n)
    val rms = sqrt(tail.sumOf { it * it } / tail.size)
    assertEquals(0.25 / sqrt(2.0) * 10.0.pow(6.0 / 20.0), rms, 0.002)
  }

  @Test
  fun limiterNeverExceedsTheCeilingAndKeepsTiming() {
    val limiter = Limiter(48_000, 2)
    val ceiling = 10.0.pow(Limiter.CEILING_DB / 20.0)
    val random = Random(7)
    val n = 64
    repeat(2_000) { block ->
      val loud = block % 3 != 0
      val l = DoubleArray(n) { (random.nextDouble() * 2 - 1) * if (loud) 4.0 else 0.2 }
      val r = DoubleArray(n) { (random.nextDouble() * 2 - 1) * if (loud) 4.0 else 0.2 }
      limiter.process(l, r, n)
      for (i in 0 until n) {
        assertTrue(abs(l[i]) <= ceiling + 1e-9)
        assertTrue(abs(r[i]) <= ceiling + 1e-9)
      }
    }

    val quiet = Limiter(48_000, 1)
    val input = DoubleArray(1_000) { 0.3 * sin(it * 0.05) }
    val output = input.copyOf()
    val scratch = DoubleArray(1_000)
    quiet.process(output, scratch, output.size)
    for (i in quiet.delay until input.size) assertEquals(input[i - quiet.delay], output[i], 1e-12)
  }

  @Test
  fun chainStaysFiniteWhileEverythingMoves() {
    val random = Random(42)
    val chain = DspChain(44_100, 2)
    val l = DoubleArray(DspChain.BLOCK)
    val r = DoubleArray(DspChain.BLOCK)
    repeat(4_000) { block ->
      if (block % 25 == 0) {
        DspEngine.update(
          SoundParams(
            enabled = random.nextInt(8) != 0,
            preampDb = random.nextDouble(-12.0, 6.0).toFloat(),
            autoHeadroom = random.nextBoolean(),
            bands = List(10) { random.nextDouble(-12.0, 12.0).toFloat() },
            bassDb = random.nextDouble(0.0, 12.0).toFloat(),
            bassFreq = random.nextDouble(40.0, 150.0).toFloat(),
            phantom = random.nextDouble().toFloat(),
            rumble = random.nextBoolean(),
            trebleDb = random.nextDouble(-6.0, 6.0).toFloat(),
            width = random.nextDouble(0.0, 2.0).toFloat(),
            balance = random.nextDouble(-1.0, 1.0).toFloat(),
            limiter = true,
          ),
        )
        DspEngine.setBypass(random.nextInt(5) == 0)
      }
      for (i in l.indices) {
        l[i] = random.nextDouble(-1.0, 1.0) * 0.9
        r[i] = if (block % 2 == 0) l[i] else random.nextDouble(-1.0, 1.0) * 0.9
      }
      chain.process(l, r, l.size)
      for (i in l.indices) {
        assertFalse(l[i].isNaN() || r[i].isNaN())
        assertTrue(abs(l[i]) <= 1.0 + 1e-9 && abs(r[i]) <= 1.0 + 1e-9)
      }
    }
  }

  @Test
  fun bypassIsBitExactAndLengthPreserving() {
    DspEngine.update(SoundParams.THRUM_DEFAULT)
    DspEngine.setBypass(true)
    val random = Random(3)
    val input = ShortArray(2 * 5_000) { random.nextInt(-32768, 32768).toShort() }
    val output = runProcessor(input, 44_100, 2, chunkFrames = 777)
    assertEquals(input.size, output.size)
    for (i in input.indices) assertEquals("sample $i", input[i], output[i])
  }

  @Test
  fun neutralChainIsAlignedWithTheInput() {
    DspEngine.update(SoundParams.FLAT.copy(rumble = false))
    val frames = 9_000
    val input = ShortArray(frames * 2) { (8_000 * sin(it / 2 * 0.013 + (it % 2) * 0.4)).toInt().toShort() }
    val output = runProcessor(input, 48_000, 2, chunkFrames = 1_024)
    assertEquals(input.size, output.size)
    for (i in input.indices) assertTrue("sample $i", abs(input[i] - output[i]) <= 1)
  }

  @Test
  fun processorEmitsSixteenBitForFloatAndSkipsSurround() {
    val processor = DspAudioProcessor()
    val out = processor.configure(AudioFormat(48_000, 2, C.ENCODING_PCM_FLOAT))
    assertEquals(C.ENCODING_PCM_16BIT, out.encoding)
    val surround = DspAudioProcessor()
    assertEquals(AudioFormat.NOT_SET, surround.configure(AudioFormat(48_000, 6, C.ENCODING_PCM_16BIT)))
    assertFalse(surround.isActive)
  }

  @Test
  fun fftFindsTheToneBin() {
    val fft = Fft(1_024)
    val re = DoubleArray(1_024) { sin(2 * PI * 37 * it / 1_024) }
    val im = DoubleArray(1_024)
    fft.forward(re, im)
    var best = 0
    for (k in 0 until 512) if (hypot(re[k], im[k]) > hypot(re[best], im[best])) best = k
    assertEquals(37, best)
    assertEquals(512.0, hypot(re[37], im[37]), 1e-6)
  }

  @Test
  fun soundParamsRoundTripAndSanitize() {
    val json = SoundParams.THRUM_DEFAULT.toJson()
    assertEquals(SoundParams.THRUM_DEFAULT, SoundParams.fromJson(json))
    assertNull(SoundParams.fromJson("not json"))

    val updated = SoundParams.fromMap(
      mapOf("bassDb" to 30.0, "width" to Double.NaN, "bands" to arrayListOf(1.0, 2.0)),
      SoundParams.THRUM_DEFAULT,
    )
    assertEquals(SoundParams.BASS_MAX, updated.bassDb, 0f)
    assertEquals(SoundParams.THRUM_DEFAULT.width, updated.width, 0f)
    assertEquals(SoundParams.THRUM_DEFAULT.bands, updated.bands)

    val bands = SoundParams.fromMap(mapOf("bands" to List(10) { it.toDouble() }), SoundParams.FLAT)
    assertEquals(9f, bands.bands[9], 0f)
    @Suppress("UNCHECKED_CAST")
    assertEquals(10, (bands.toMap()["bands"] as List<Double>).size)
  }

  @Test
  fun headroomCoversTheBoost() {
    assertEquals(0f, DspEngine.headroomFor(SoundParams.FLAT), 0f)
    assertEquals(0f, DspEngine.headroomFor(SoundParams.THRUM_DEFAULT.copy(autoHeadroom = false)), 0f)
    val boost = EqLayout.maxBoostDb(SoundParams.THRUM_DEFAULT)
    assertTrue(boost > 4.0)
    val expected = -0.75 * (boost + 1.5 * SoundParams.THRUM_DEFAULT.phantom)
    assertEquals(expected, DspEngine.headroomFor(SoundParams.THRUM_DEFAULT).toDouble(), 0.06)
  }

  @Test
  fun spectrumLightsTheBandOfATone() {
    val tap = SpectrumTap()
    tap.configure(48_000)
    val l = DoubleArray(DspChain.BLOCK)
    var t = 0
    repeat(200) {
      for (i in l.indices) l[i] = 0.05 * sin(2 * PI * 1_000.0 * t++ / 48_000.0)
      tap.write(l, l, l.size, stereo = false)
    }
    tap.touch(System.nanoTime())
    var frame: SpectrumFrame? = null
    var now = System.nanoTime()
    repeat(30) {
      now += 16_000_000L
      tap.touch(now)
      frame = tap.read(0, now, 0f)
    }
    assertNotNull(frame)
    val bands = frame!!.bands
    val loudest = bands.indices.maxByOrNull { bands[it] }!!
    val ratio = 16_000.0 / 30.0
    val lo = 30.0 * ratio.pow(loudest / 48.0)
    val hi = 30.0 * ratio.pow((loudest + 1) / 48.0)
    assertTrue("band $loudest is $lo..$hi Hz", 1_000.0 in (lo * 0.85)..(hi * 1.15))
    assertTrue(bands[loudest] in 0.4f..0.95f)
    assertEquals(48, (frame!!.toMap()["bands"] as List<*>).size)
  }

  /** Runs interleaved 16-bit PCM through a configured processor, including the end-of-stream drain. */
  private fun runProcessor(input: ShortArray, sampleRate: Int, channels: Int, chunkFrames: Int): ShortArray {
    val processor = DspAudioProcessor()
    processor.configure(AudioFormat(sampleRate, channels, C.ENCODING_PCM_16BIT))
    processor.flush(AudioProcessor.StreamMetadata.DEFAULT)
    val collected = ArrayList<Short>(input.size)
    fun collect() {
      val out = processor.output
      while (out.remaining() >= 2) collected.add(out.short)
    }
    var offset = 0
    while (offset < input.size) {
      val count = minOf(chunkFrames * channels, input.size - offset)
      val buffer = ByteBuffer.allocateDirect(count * 2).order(ByteOrder.nativeOrder())
      for (i in 0 until count) buffer.putShort(input[offset + i])
      buffer.flip()
      processor.queueInput(buffer)
      assertFalse(buffer.hasRemaining())
      collect()
      offset += count
    }
    processor.queueEndOfStream()
    processor.queueEndOfStream()
    assertFalse(processor.isEnded)
    collect()
    assertTrue(processor.isEnded)
    return collected.toShortArray()
  }
}
