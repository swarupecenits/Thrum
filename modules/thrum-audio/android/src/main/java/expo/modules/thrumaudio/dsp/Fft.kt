package expo.modules.thrumaudio.dsp

import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/** In-place iterative radix-2 complex FFT with precomputed twiddles. Not thread-safe per instance. */
internal class Fft(val size: Int) {
  private val cosTable = DoubleArray(size / 2)
  private val sinTable = DoubleArray(size / 2)
  private val reversed = IntArray(size)

  init {
    require(size >= 2 && size and (size - 1) == 0) { "FFT size must be a power of two" }
    for (k in 0 until size / 2) {
      val angle = 2.0 * PI * k / size
      cosTable[k] = cos(angle)
      sinTable[k] = sin(angle)
    }
    var bits = 0
    while (1 shl bits < size) bits++
    for (i in 0 until size) {
      var x = i
      var r = 0
      for (b in 0 until bits) {
        r = (r shl 1) or (x and 1)
        x = x shr 1
      }
      reversed[i] = r
    }
  }

  /** Forward transform: X[k] = sum x[n] e^(-2 pi i k n / N). */
  fun forward(re: DoubleArray, im: DoubleArray) {
    val n = size
    for (i in 0 until n) {
      val j = reversed[i]
      if (j > i) {
        val tr = re[i]; re[i] = re[j]; re[j] = tr
        val ti = im[i]; im[i] = im[j]; im[j] = ti
      }
    }
    var span = 2
    while (span <= n) {
      val half = span / 2
      val step = n / span
      var start = 0
      while (start < n) {
        var t = 0
        for (j in start until start + half) {
          val m = j + half
          val c = cosTable[t]
          val s = sinTable[t]
          val tr = re[m] * c + im[m] * s
          val ti = im[m] * c - re[m] * s
          re[m] = re[j] - tr
          im[m] = im[j] - ti
          re[j] += tr
          im[j] += ti
          t += step
        }
        start += span
      }
      span *= 2
    }
  }

  companion object {
    fun hann(size: Int): DoubleArray = DoubleArray(size) { 0.5 - 0.5 * cos(2.0 * PI * it / size) }
  }
}
