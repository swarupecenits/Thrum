package expo.modules.thrumaudio.tags

import java.nio.ByteBuffer
import java.nio.channels.FileChannel
import kotlin.math.min

/** Random-access bytes: a file channel in production, an array in tests. */
internal interface Source {
  val size: Long

  /** Reads up to [len] bytes at [pos]; returns how many were read (0 at the end). */
  fun read(pos: Long, dst: ByteArray, off: Int, len: Int): Int
}

internal class BytesSource(private val data: ByteArray) : Source {
  override val size: Long get() = data.size.toLong()

  override fun read(pos: Long, dst: ByteArray, off: Int, len: Int): Int {
    if (pos < 0 || pos >= data.size || len <= 0) return 0
    val n = min(len.toLong(), data.size - pos).toInt()
    System.arraycopy(data, pos.toInt(), dst, off, n)
    return n
  }
}

internal class ChannelSource(private val channel: FileChannel) : Source {
  override val size: Long = channel.size()

  override fun read(pos: Long, dst: ByteArray, off: Int, len: Int): Int {
    if (pos < 0 || len <= 0) return 0
    val buffer = ByteBuffer.wrap(dst, off, len)
    var done = 0
    while (buffer.hasRemaining()) {
      val r = channel.read(buffer, pos + done)
      if (r <= 0) break
      done += r
    }
    return done
  }
}

/** Exactly [len] bytes at [pos], or null when the source is shorter. */
internal fun Source.bytes(pos: Long, len: Int): ByteArray? {
  if (len < 0 || pos < 0 || pos + len > size) return null
  val out = ByteArray(len)
  return if (read(pos, out, 0, len) == len) out else null
}

/** Sequential reader with a small buffer, for structures that are walked front to back. */
internal abstract class ByteStream {
  private val buf = ByteArray(8192)
  private var bufPos = 0
  private var bufLen = 0

  /** Supplies up to [len] more bytes; 0 at the end. */
  protected abstract fun fill(dst: ByteArray, off: Int, len: Int): Int

  /** Skips up to [n] bytes without reading them; returns how many were skipped. */
  protected abstract fun skipRaw(n: Long): Long

  fun u8(): Int {
    if (bufPos == bufLen) {
      bufLen = fill(buf, 0, buf.size).coerceAtLeast(0)
      bufPos = 0
      if (bufLen == 0) return -1
    }
    return buf[bufPos++].toInt() and 0xFF
  }

  fun readFully(dst: ByteArray, off: Int = 0, len: Int = dst.size): Boolean {
    var o = off
    var n = len
    val buffered = min(n, bufLen - bufPos)
    if (buffered > 0) {
      System.arraycopy(buf, bufPos, dst, o, buffered)
      bufPos += buffered
      o += buffered
      n -= buffered
    }
    while (n > 0) {
      val r = fill(dst, o, n)
      if (r <= 0) return false
      o += r
      n -= r
    }
    return true
  }

  fun skip(n: Long): Boolean {
    if (n < 0) return false
    var left = n
    val buffered = min(left, (bufLen - bufPos).toLong()).toInt()
    bufPos += buffered
    left -= buffered
    while (left > 0) {
      val s = skipRaw(left)
      if (s <= 0) return false
      left -= s
    }
    return true
  }

  /** Little-endian u32, or -1 at the end. */
  fun u32le(): Long {
    var v = 0L
    for (i in 0 until 4) {
      val b = u8()
      if (b < 0) return -1
      v = v or (b.toLong() shl (8 * i))
    }
    return v
  }
}

/** Streams the byte range [start, end) of a [Source]. */
internal class SourceStream(private val src: Source, start: Long, end: Long) : ByteStream() {
  private var pos = start
  private val end = min(end, src.size)

  override fun fill(dst: ByteArray, off: Int, len: Int): Int {
    val n = min(len.toLong(), end - pos).toInt()
    if (n <= 0) return 0
    val r = src.read(pos, dst, off, n)
    if (r > 0) pos += r
    return r
  }

  override fun skipRaw(n: Long): Long {
    val s = min(n, end - pos)
    if (s <= 0) return 0
    pos += s
    return s
  }
}

// region byte helpers

internal fun ByteArray.u8(i: Int) = this[i].toInt() and 0xFF

internal fun ByteArray.be16(i: Int) = (u8(i) shl 8) or u8(i + 1)

internal fun ByteArray.be24(i: Int) = (u8(i) shl 16) or (u8(i + 1) shl 8) or u8(i + 2)

internal fun ByteArray.be32(i: Int): Long =
  (u8(i).toLong() shl 24) or (u8(i + 1).toLong() shl 16) or (u8(i + 2).toLong() shl 8) or u8(i + 3).toLong()

internal fun ByteArray.be64(i: Int): Long = (be32(i) shl 32) or be32(i + 4)

internal fun ByteArray.le16(i: Int) = u8(i) or (u8(i + 1) shl 8)

internal fun ByteArray.le32(i: Int): Long =
  u8(i).toLong() or (u8(i + 1).toLong() shl 8) or (u8(i + 2).toLong() shl 16) or (u8(i + 3).toLong() shl 24)

internal fun ByteArray.ascii(i: Int, n: Int): String = String(this, i, n, Charsets.ISO_8859_1)

internal fun ByteArray.hasAt(i: Int, text: String): Boolean {
  if (i < 0 || i + text.length > size) return false
  for (k in text.indices) if (u8(i + k) != text[k].code) return false
  return true
}

// endregion
