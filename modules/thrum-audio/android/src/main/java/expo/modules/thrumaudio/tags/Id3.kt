package expo.modules.thrumaudio.tags

import java.io.ByteArrayOutputStream
import java.util.Locale
import java.util.zip.DataFormatException
import java.util.zip.Inflater

/** ID3v2.2–2.4 tags: USLT/SYLT lyrics and TXXX user fields (ReplayGain, lyrics kept as text). */
internal object Id3 {
  private const val MAX_TAG = 32 * 1024 * 1024
  private const val MAX_FRAME = 4 * 1024 * 1024
  private const val LYRICS = 1
  private const val SYNCED = 2
  private const val USER = 3

  /** Parses an ID3v2 tag at [pos]. Returns its total length, or 0 when there is none. */
  fun parse(src: Source, pos: Long, tags: Tags): Long {
    val h = src.bytes(pos, 10) ?: return 0
    if (!h.hasAt(0, "ID3") || h.u8(3) == 0xFF || h.u8(4) == 0xFF) return 0
    val size = synchsafe(h, 6)
    if (size < 0) return 0
    val major = h.u8(3)
    val flags = h.u8(5)
    val total = 10L + size + if (major == 4 && flags and 0x10 != 0) 10 else 0
    // v2.2 "compressed" tags have no defined scheme, so they are skipped.
    if (major !in 2..4 || (major == 2 && flags and 0x40 != 0) || pos + 10 + size > src.size) return total
    val unsync = flags and 0x80 != 0
    if (major < 4 && unsync) {
      // Before v2.4 unsynchronisation covers the whole tag, frame headers included.
      if (size > MAX_TAG) return total
      val raw = src.bytes(pos + 10, size) ?: return total
      val body = deunsync(raw, 0, raw.size)
      frames(BytesSource(body), 0, body.size.toLong(), major, flags, false, tags)
    } else {
      frames(src, pos + 10, pos + 10 + size, major, flags, unsync, tags)
    }
    return total
  }

  private fun frames(src: Source, start: Long, end: Long, major: Int, flags: Int, tagUnsync: Boolean, tags: Tags) {
    var p = start
    if (major >= 3 && flags and 0x40 != 0) {
      val ext = src.bytes(p, 4) ?: return
      // v2.3 counts the bytes after the size field; v2.4 counts the whole extended header.
      val skip = if (major == 3) 4 + ext.be32(0) else synchsafe(ext, 0).toLong()
      if (skip < 4) return
      p += skip
    }
    val headerLen = if (major == 2) 6 else 10
    while (p + headerLen <= end) {
      val fh = src.bytes(p, headerLen) ?: return
      if (fh.u8(0) == 0) return // padding
      val id = fh.ascii(0, if (major == 2) 3 else 4)
      if (!validId(id)) return
      val body = p + headerLen
      val size = when (major) {
        2 -> fh.be24(3).toLong()
        3 -> fh.be32(4)
        else -> v24Size(src, fh, body, end)
      }
      if (size < 0 || body + size > end) return
      val kind = when (id) {
        "USLT", "ULT" -> LYRICS
        "SYLT", "SLT" -> SYNCED
        "TXXX", "TXX" -> USER
        else -> 0
      }
      if (kind != 0 && size >= 1 && size <= MAX_FRAME) {
        val flagsOfFrame = if (major == 2) 0 else fh.be16(8)
        src.bytes(body, size.toInt())
          ?.let { unwrap(it, major, flagsOfFrame, tagUnsync) }
          ?.let { handle(kind, it, tags) }
      }
      p = body + size
    }
  }

  /** v2.4 sizes are synchsafe, but some writers used plain integers; trust whichever lands on a frame. */
  private fun v24Size(src: Source, fh: ByteArray, body: Long, end: Long): Long {
    val raw = fh.be32(4)
    val safe = synchsafe(fh, 4)
    if (safe < 0) return raw
    if (safe.toLong() == raw || plausibleNext(src, body + safe, end)) return safe.toLong()
    if (plausibleNext(src, body + raw, end)) return raw
    return safe.toLong()
  }

  private fun plausibleNext(src: Source, at: Long, end: Long): Boolean {
    if (at == end) return true
    if (at > end) return false
    val b = src.bytes(at, minOf(4L, end - at).toInt()) ?: return false
    if (b.u8(0) == 0) return true
    return b.size == 4 && validId(b.ascii(0, 4))
  }

  /** Strips per-frame wrappers (v2.3 compression/grouping, v2.4 grouping/length/unsync/compression). */
  private fun unwrap(raw: ByteArray, major: Int, f: Int, tagUnsync: Boolean): ByteArray? {
    when (major) {
      3 -> {
        if (f and 0x0040 != 0) return null // encrypted
        val compressed = f and 0x0080 != 0
        var start = 0
        if (compressed) start += 4
        if (f and 0x0020 != 0) start += 1
        if (start > raw.size) return null
        val data = raw.copyOfRange(start, raw.size)
        return if (compressed) inflate(data) else data
      }
      4 -> {
        if (f and 0x0004 != 0) return null // encrypted
        var start = 0
        if (f and 0x0040 != 0) start += 1
        if (f and 0x0001 != 0) start += 4
        if (start > raw.size) return null
        val data = if (tagUnsync || f and 0x0002 != 0) deunsync(raw, start, raw.size) else raw.copyOfRange(start, raw.size)
        return if (f and 0x0008 != 0) inflate(data) else data
      }
      else -> return raw
    }
  }

  private fun handle(kind: Int, d: ByteArray, tags: Tags) {
    if (d.isEmpty()) return
    val enc = d.u8(0)
    if (enc > 3) return
    when (kind) {
      LYRICS -> {
        if (d.size < 4) return
        val text = Text(d, 4, enc)
        text.term() // content descriptor
        tags.addLyrics(text.rest())
      }
      SYNCED -> {
        if (d.size < 6 || d.u8(4) != 2) return // only millisecond timestamps map to LRC
        val text = Text(d, 6, enc)
        text.term()
        sylt(text)?.let(tags::addLyrics)
      }
      USER -> {
        val text = Text(d, 1, enc)
        val key = text.term()
        if (tags.wants(key)) tags.field(key, text.term())
      }
    }
  }

  /** SYLT items to LRC. Items starting with a newline mark line starts in syllable-timed lyrics. */
  private fun sylt(text: Text): String? {
    val items = ArrayList<Pair<Long, String>>()
    while (text.pos < text.data.size) {
      val s = text.term()
      if (text.pos + 4 > text.data.size) break
      items += text.data.be32(text.pos) to s
      text.pos += 4
    }
    if (items.isEmpty()) return null
    val syllables = items.any { it.second.startsWith("\n") || it.second.startsWith("\r") }
    val lines = ArrayList<Pair<Long, StringBuilder>>()
    for ((ms, s) in items) {
      val newLine = s.startsWith("\n") || s.startsWith("\r")
      if (!syllables || lines.isEmpty() || newLine) {
        lines += ms to StringBuilder(s.trimStart('\r', '\n'))
      } else {
        lines.last().second.append(s)
      }
    }
    return lines.joinToString("\n") { (ms, sb) -> stamp(ms) + sb.toString().replace(Regex("[\r\n]+"), " ").trim() }
  }

  fun stamp(ms: Long): String {
    val cs = ms / 10
    return String.format(Locale.ROOT, "[%02d:%02d.%02d]", cs / 6000, (cs / 100) % 60, cs % 100)
  }

  fun synchsafe(b: ByteArray, i: Int): Int {
    var v = 0
    for (k in 0 until 4) {
      val x = b.u8(i + k)
      if (x and 0x80 != 0) return -1
      v = (v shl 7) or x
    }
    return v
  }

  fun deunsync(b: ByteArray, from: Int, to: Int): ByteArray {
    val out = ByteArray(maxOf(0, to - from))
    var n = 0
    var i = from
    while (i < to) {
      val v = b[i]
      out[n++] = v
      i += if (v.toInt() and 0xFF == 0xFF && i + 1 < to && b[i + 1].toInt() == 0) 2 else 1
    }
    return out.copyOf(n)
  }

  private fun validId(id: String) = id.isNotEmpty() && id.all { it in 'A'..'Z' || it in '0'..'9' }

  private fun inflate(data: ByteArray): ByteArray? {
    val inflater = Inflater()
    return try {
      inflater.setInput(data)
      val out = ByteArrayOutputStream(minOf(data.size * 3, 1 shl 20).coerceAtLeast(64))
      val buf = ByteArray(8192)
      while (!inflater.finished()) {
        val n = inflater.inflate(buf)
        if (n == 0) break // needs input or a dictionary: truncated or unsupported stream
        out.write(buf, 0, n)
        if (out.size() > MAX_FRAME) return null
      }
      out.toByteArray()
    } catch (_: DataFormatException) {
      null
    } finally {
      inflater.end()
    }
  }

  /** Reads ID3 strings in one of the four text encodings. */
  private class Text(val data: ByteArray, var pos: Int, private val enc: Int) {
    private val wide = enc == 1 || enc == 2

    /** Up to the encoding's terminator, stepping past it. */
    fun term(): String {
      val start = pos
      var end = data.size
      if (wide) {
        var i = start
        while (i + 1 < data.size) {
          if (data[i].toInt() == 0 && data[i + 1].toInt() == 0) {
            end = i
            break
          }
          i += 2
        }
        pos = if (end < data.size) end + 2 else data.size
      } else {
        var i = start
        while (i < data.size && data[i].toInt() != 0) i++
        end = i
        pos = if (i < data.size) i + 1 else data.size
      }
      return decode(start, end)
    }

    fun rest(): String {
      val s = decode(pos, data.size)
      pos = data.size
      return s
    }

    private fun decode(from: Int, to: Int): String {
      if (to <= from) return ""
      val charset = when (enc) {
        0 -> Charsets.ISO_8859_1
        1 -> Charsets.UTF_16
        2 -> Charsets.UTF_16BE
        else -> Charsets.UTF_8
      }
      return String(data, from, to - from, charset).trimEnd('\u0000')
    }
  }
}
