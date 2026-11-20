package expo.modules.thrumaudio.tags

import java.util.Locale
import kotlin.math.pow
import kotlin.math.roundToInt

/** Detects the container by its magic bytes and runs the matching parsers. Pure Kotlin. */
internal object TagParser {
  fun parse(src: Source, tags: Tags) {
    var pos = 0L
    // Leading ID3v2 tags; a few files stack more than one.
    for (i in 0 until 3) {
      val len = Id3.parse(src, pos, tags)
      if (len <= 0) break
      pos += len
    }
    val first = src.bytes(pos, 12)
    if (pos > 0 && (first == null || !known(first))) {
      // Some taggers pad past the size they declare; look a little further for a FLAC stream.
      val found = find(src, pos, "fLaC", 64 * 1024)
      if (found >= 0) pos = found
    }
    val head = src.bytes(pos, 12)
    if (head != null) {
      when {
        head.hasAt(0, "fLaC") -> Flac.parse(src, pos, tags)
        head.hasAt(0, "OggS") -> Ogg.parse(src, pos, tags)
        head.hasAt(4, "ftyp") -> Mp4.parse(src, pos, tags)
        head.hasAt(0, "RIFF") && head.hasAt(8, "WAVE") -> Riff.parse(src, pos, tags)
        head.hasAt(0, "FORM") && (head.hasAt(8, "AIFF") || head.hasAt(8, "AIFC")) ->
          Aiff.parse(src, pos, tags, head.hasAt(8, "AIFC"))
        // Layer bits 01 = Layer III; ADTS AAC shares the sync word but has layer 00.
        isMpeg(head) && (head.u8(1) shr 1) and 0x3 == 1 -> if (tags.codec == null) tags.codec = "MP3"
      }
    }
    Ape.parse(src, tags)
  }

  private fun isMpeg(h: ByteArray) = h.u8(0) == 0xFF && h.u8(1) and 0xE0 == 0xE0

  private fun known(h: ByteArray) =
    h.hasAt(0, "fLaC") || h.hasAt(0, "OggS") || h.hasAt(4, "ftyp") || h.hasAt(0, "RIFF") || h.hasAt(0, "FORM") || isMpeg(h)

  private fun find(src: Source, from: Long, magic: String, limit: Int): Long {
    val len = minOf(limit.toLong(), src.size - from).toInt()
    if (len < magic.length) return -1
    val block = src.bytes(from, len) ?: return -1
    for (i in 0..len - magic.length) if (block.hasAt(i, magic)) return from + i
    return -1
  }
}

/** Vorbis comments (FLAC, Ogg Vorbis/Opus/FLAC), streamed so huge embedded pictures are skipped. */
internal object VorbisComments {
  private const val MAX_VALUE = 1 shl 20

  fun parse(s: ByteStream, tags: Tags) {
    val vendor = s.u32le()
    if (vendor < 0 || !s.skip(vendor)) return
    val count = s.u32le()
    if (count < 0) return
    val key = StringBuilder()
    var i = 0L
    while (i < count && i < 100_000) {
      i++
      val len = s.u32le()
      if (len < 0) return
      key.setLength(0)
      var used = 0L
      var found = false
      while (used < len && used < 64) {
        val b = s.u8()
        if (b < 0) return
        used++
        if (b == '='.code) {
          found = true
          break
        }
        key.append(b.toChar())
      }
      val rest = len - used
      val name = key.toString()
      if (!found || rest > MAX_VALUE || !tags.wants(name)) {
        if (!s.skip(rest)) return
        continue
      }
      val value = ByteArray(rest.toInt())
      if (!s.readFully(value)) return
      tags.field(name, String(value, Charsets.UTF_8))
    }
  }
}

internal object Flac {
  fun parse(src: Source, pos: Long, tags: Tags) {
    tags.codec = "FLAC"
    var p = pos + 4
    for (guard in 0 until 1024) {
      val h = src.bytes(p, 4) ?: return
      val last = h.u8(0) and 0x80 != 0
      val type = h.u8(0) and 0x7F
      val len = h.be24(1)
      val body = p + 4
      if (body + len > src.size) return
      when (type) {
        0 -> src.bytes(body, 18)?.let { streamInfo(it, 0, tags) }
        4 -> VorbisComments.parse(SourceStream(src, body, body + len), tags)
      }
      p = body + len
      if (last) {
        tags.audioBytes = src.size - p
        return
      }
    }
  }

  /** STREAMINFO: 20-bit rate, 3-bit channels-1, 5-bit bits-1 starting at byte 10. */
  fun streamInfo(b: ByteArray, i: Int, tags: Tags) {
    if (b.size < i + 14) return
    val rate = (b.u8(i + 10) shl 12) or (b.u8(i + 11) shl 4) or (b.u8(i + 12) shr 4)
    if (rate > 0) tags.sampleRate = rate
    tags.channels = ((b.u8(i + 12) shr 1) and 0x7) + 1
    tags.bitDepth = (((b.u8(i + 12) and 0x1) shl 4) or (b.u8(i + 13) shr 4)) + 1
  }
}

/** Walks the packets of the first logical stream in an Ogg file. */
internal class OggPackets(private val src: Source, private var pageAt: Long) {
  private var serial = -1L
  private val lacing = IntArray(255)
  private var segCount = 0
  private var seg = 0
  private var segLeft = 0
  private var cursor = 0L
  private var started = false
  private var ended = true
  private var pages = 0

  /** Moves to the start of the next packet; false at the end of the stream. */
  fun begin(): Boolean {
    if (!ended) skipRest()
    val ok = if (!started) {
      started = true
      loadPage()
    } else {
      nextSegment()
    }
    ended = !ok
    return ok
  }

  fun read(dst: ByteArray, off: Int, len: Int): Int {
    var done = 0
    while (done < len && step()) {
      val r = src.read(cursor, dst, off + done, minOf(len - done, segLeft))
      if (r <= 0) {
        ended = true
        break
      }
      cursor += r
      segLeft -= r
      done += r
    }
    return done
  }

  fun skip(n: Long): Long {
    var done = 0L
    while (done < n && step()) {
      val k = minOf(n - done, segLeft.toLong()).toInt()
      cursor += k
      segLeft -= k
      done += k
    }
    return done
  }

  fun skipRest() {
    while (step()) {
      cursor += segLeft
      segLeft = 0
    }
  }

  fun stream(): ByteStream = object : ByteStream() {
    override fun fill(dst: ByteArray, off: Int, len: Int) = this@OggPackets.read(dst, off, len)
    override fun skipRaw(n: Long) = this@OggPackets.skip(n)
  }

  /** Ensures the current segment has unread bytes; false once the packet is over. */
  private fun step(): Boolean {
    while (!ended && segLeft == 0) {
      // A lacing value below 255 closes the packet; 255 means it continues.
      if (lacing[seg] < 255 || !nextSegment()) ended = true
    }
    return !ended
  }

  private fun nextSegment(): Boolean {
    seg++
    while (seg >= segCount) if (!loadPage()) return false
    segLeft = lacing[seg]
    return true
  }

  private fun loadPage(): Boolean {
    while (pages < MAX_PAGES) {
      pages++
      val h = src.bytes(pageAt, 27) ?: return false
      if (!h.hasAt(0, "OggS")) return false
      val n = h.u8(26)
      val table = src.bytes(pageAt + 27, n) ?: return false
      var bodyLen = 0L
      for (i in 0 until n) bodyLen += table.u8(i)
      val body = pageAt + 27 + n
      pageAt = body + bodyLen
      val pageSerial = h.le32(14)
      if (serial < 0) serial = pageSerial
      if (pageSerial != serial || n == 0) continue
      for (i in 0 until n) lacing[i] = table.u8(i)
      segCount = n
      seg = 0
      segLeft = lacing[0]
      cursor = body
      return true
    }
    return false
  }

  private companion object {
    const val MAX_PAGES = 8192
  }
}

internal object Ogg {
  fun parse(src: Source, pos: Long, tags: Tags) {
    val ogg = OggPackets(src, pos)
    if (!ogg.begin()) return
    val head = ByteArray(64)
    val n = ogg.read(head, 0, head.size)
    val comments = when {
      n >= 16 && head.hasAt(0, "\u0001vorbis") -> {
        tags.codec = "Vorbis"
        tags.channels = head.u8(11)
        tags.sampleRate = head.le32(12).toInt()
        "\u0003vorbis"
      }
      n >= 19 && head.hasAt(0, "OpusHead") -> {
        tags.codec = "Opus"
        tags.channels = head.u8(9)
        tags.sampleRate = 48_000 // Opus always decodes at 48 kHz
        "OpusTags"
      }
      n >= 31 && head.hasAt(0, "\u007fFLAC") -> {
        tags.codec = "FLAC"
        Flac.streamInfo(head, 17, tags)
        ""
      }
      else -> return
    }
    if (!ogg.begin()) return
    val s = ogg.stream()
    if (comments.isNotEmpty()) {
      val magic = ByteArray(comments.length)
      if (!s.readFully(magic) || !magic.hasAt(0, comments)) return
    } else {
      // Ogg FLAC: the second packet is a VORBIS_COMMENT metadata block.
      val block = ByteArray(4)
      if (!s.readFully(block) || block.u8(0) and 0x7F != 4) return
    }
    VorbisComments.parse(s, tags)
  }
}

/** ISO base media (M4A/ALAC): iTunes ©lyr and ---- freeform atoms, plus the sample entry. */
internal object Mp4 {
  private const val LYRICS = "\u00a9lyr"
  private const val MAX_TEXT = 1L shl 20

  fun parse(src: Source, pos: Long, tags: Tags) {
    boxes(src, pos, src.size) { type, s, e ->
      when (type) {
        "moov" -> moov(src, s, e, tags)
        "mdat" -> tags.audioBytes = (tags.audioBytes ?: 0L) + (e - s)
      }
    }
  }

  private fun boxes(src: Source, start: Long, end: Long, visit: (String, Long, Long) -> Unit) {
    var p = start
    var guard = 0
    while (p + 8 <= end && guard++ < 10_000) {
      val h = src.bytes(p, 8) ?: return
      var size = h.be32(0)
      var header = 8L
      if (size == 1L) {
        size = src.bytes(p + 8, 8)?.be64(0) ?: return
        header = 16L
      } else if (size == 0L) {
        size = end - p
      }
      if (size < header || size > end - p) return
      visit(h.ascii(4, 4), p + header, p + size)
      p += size
    }
  }

  private fun moov(src: Source, start: Long, end: Long, tags: Tags) {
    boxes(src, start, end) { type, s, e ->
      when (type) {
        "udta" -> boxes(src, s, e) { t, s2, e2 -> if (t == "meta") meta(src, s2, e2, tags) }
        "meta" -> meta(src, s, e, tags)
        "trak" -> path(src, s, e, listOf("mdia", "minf", "stbl", "stsd")) { s2, e2 -> sampleEntry(src, s2, e2, tags) }
      }
    }
  }

  private fun path(src: Source, start: Long, end: Long, names: List<String>, leaf: (Long, Long) -> Unit) {
    if (names.isEmpty()) return leaf(start, end)
    boxes(src, start, end) { t, s, e -> if (t == names[0]) path(src, s, e, names.drop(1), leaf) }
  }

  private fun meta(src: Source, start: Long, end: Long, tags: Tags) {
    // ISO "meta" is a full box (4 bytes of version/flags); QuickTime's is not. An "hdlr" child tells.
    val probe = src.bytes(start, 8) ?: return
    val children = if (probe.hasAt(4, "hdlr")) start else start + 4
    boxes(src, children, end) { type, s, e -> if (type == "ilst") ilst(src, s, e, tags) }
  }

  private fun ilst(src: Source, start: Long, end: Long, tags: Tags) {
    boxes(src, start, end) { type, s, e ->
      when (type) {
        LYRICS -> utf8Data(src, s, e)?.let(tags::addLyrics)
        "----" -> freeform(src, s, e, tags)
      }
    }
  }

  /** The first UTF-8 (well-known type 1) "data" child. */
  private fun utf8Data(src: Source, start: Long, end: Long): String? {
    var out: String? = null
    boxes(src, start, end) { type, s, e ->
      val len = e - s
      if (out == null && type == "data" && len >= 8 && len <= MAX_TEXT) {
        val d = src.bytes(s, len.toInt())
        if (d != null && d.be32(0) and 0xFFFFFF == 1L) out = String(d, 8, d.size - 8, Charsets.UTF_8)
      }
    }
    return out
  }

  private fun freeform(src: Source, start: Long, end: Long, tags: Tags) {
    var name: String? = null
    boxes(src, start, end) { type, s, e ->
      val len = e - s
      if (type == "name" && len >= 5 && len <= 256) {
        name = src.bytes(s + 4, (len - 4).toInt())?.let { String(it, Charsets.UTF_8) }
      }
    }
    val key = name ?: return
    if (!tags.wants(key)) return
    utf8Data(src, start, end)?.let { tags.field(key, it) }
  }

  private fun sampleEntry(src: Source, start: Long, end: Long, tags: Tags) {
    // stsd: version/flags + entry count, then sample entries.
    boxes(src, start + 8, end) { type, s, _ ->
      if (tags.codec != null) return@boxes
      val label = when (type) {
        "alac" -> "ALAC"
        "mp4a" -> "AAC"
        "fLaC" -> "FLAC"
        "Opus" -> "Opus"
        "ac-3" -> "AC-3"
        "ec-3" -> "E-AC-3"
        ".mp3" -> "MP3"
        else -> return@boxes
      }
      tags.codec = label
      val entry = src.bytes(s, 20) ?: return@boxes
      val channels = entry.be16(16)
      val bits = entry.be16(18)
      if (channels in 1..32) tags.channels = channels
      if ((label == "ALAC" || label == "FLAC") && bits in 8..32) tags.bitDepth = bits
    }
  }
}

/** APEv2 items at the end of the file (before an ID3v1 tag if there is one). */
internal object Ape {
  private const val MAX_VALUE = 1L shl 20

  fun parse(src: Source, tags: Tags) {
    if (src.size < 32) return
    if (at(src, src.size - 32, tags)) return
    if (src.size >= 160 && src.bytes(src.size - 128, 3)?.hasAt(0, "TAG") == true) at(src, src.size - 160, tags)
  }

  private fun at(src: Source, footer: Long, tags: Tags): Boolean {
    val f = src.bytes(footer, 32) ?: return false
    if (!f.hasAt(0, "APETAGEX")) return false
    val size = f.le32(12)
    val count = f.le32(16)
    val start = footer + 32 - size
    if (size < 32 || start < 0) return true
    val s = SourceStream(src, start, footer)
    val key = StringBuilder()
    for (i in 0L until minOf(count, 10_000L)) {
      val len = s.u32le()
      val flags = s.u32le()
      if (len < 0 || flags < 0) break
      key.setLength(0)
      var b = s.u8()
      while (b > 0 && key.length < 255) {
        key.append(b.toChar())
        b = s.u8()
      }
      if (b != 0) break
      val name = key.toString()
      val isText = (flags shr 1) and 0x3L == 0L
      if (isText && len <= MAX_VALUE && tags.wants(name)) {
        val value = ByteArray(len.toInt())
        if (!s.readFully(value)) break
        tags.field(name, String(value, Charsets.UTF_8))
      } else if (!s.skip(len)) {
        break
      }
    }
    return true
  }
}

internal object Riff {
  fun parse(src: Source, pos: Long, tags: Tags) {
    var p = pos + 12
    var guard = 0
    while (p + 8 <= src.size && guard++ < 10_000) {
      val h = src.bytes(p, 8) ?: return
      val size = h.le32(4)
      val body = p + 8
      when (h.ascii(0, 4)) {
        "fmt " -> src.bytes(body, minOf(size, 40L).toInt())?.let { format(it, tags) }
        "data" -> tags.audioBytes = minOf(size, src.size - body)
        "id3 ", "ID3 " -> Id3.parse(src, body, tags)
      }
      p = body + size + (size and 1L)
    }
  }

  private fun format(b: ByteArray, tags: Tags) {
    if (b.size < 16) return
    var code = b.le16(0)
    tags.channels = b.le16(2)
    tags.sampleRate = b.le32(4).toInt()
    var bits = b.le16(14)
    if (code == 0xFFFE && b.size >= 26) {
      code = b.le16(24) // WAVE_FORMAT_EXTENSIBLE: the sub-format GUID starts with the real code
      val valid = b.le16(18)
      if (valid in 1..bits) bits = valid
    }
    tags.codec = when (code) {
      1, 3 -> "PCM"
      0x55 -> "MP3"
      2, 0x11 -> "ADPCM"
      6 -> "A-law"
      7 -> "\u00b5-law"
      else -> "WAV"
    }
    if (code == 1 || code == 3) tags.bitDepth = bits
  }
}

internal object Aiff {
  fun parse(src: Source, pos: Long, tags: Tags, aifc: Boolean) {
    var p = pos + 12
    var guard = 0
    while (p + 8 <= src.size && guard++ < 10_000) {
      val h = src.bytes(p, 8) ?: return
      val size = h.be32(4)
      val body = p + 8
      when (h.ascii(0, 4)) {
        "COMM" -> src.bytes(body, minOf(size, 64L).toInt())?.let { common(it, aifc, tags) }
        "SSND" -> tags.audioBytes = maxOf(0L, minOf(size, src.size - body) - 8)
        "ID3 ", "id3 " -> Id3.parse(src, body, tags)
      }
      p = body + size + (size and 1L)
    }
  }

  private fun common(b: ByteArray, aifc: Boolean, tags: Tags) {
    if (b.size < 18) return
    tags.channels = b.be16(0)
    val bits = b.be16(6)
    val rate = extended(b, 8)
    if (rate in 1.0..1e6) tags.sampleRate = rate.roundToInt()
    val compression = if (aifc && b.size >= 22) b.ascii(18, 4) else "NONE"
    when (compression) {
      "NONE", "sowt", "twos", "in24", "in32", "raw " -> {
        tags.codec = "PCM"
        tags.bitDepth = bits
      }
      "fl32", "FL32" -> {
        tags.codec = "PCM"
        tags.bitDepth = 32
      }
      "fl64", "FL64" -> {
        tags.codec = "PCM"
        tags.bitDepth = 64
      }
      else -> tags.codec = compression.trim().uppercase(Locale.ROOT)
    }
  }

  /** 80-bit IEEE 754 extended (big-endian), used for AIFF sample rates. */
  fun extended(b: ByteArray, i: Int): Double {
    val exponent = ((b.u8(i) and 0x7F) shl 8) or b.u8(i + 1)
    var mantissa = 0L
    for (k in 0 until 8) mantissa = (mantissa shl 8) or b.u8(i + 2 + k).toLong()
    if (exponent == 0 && mantissa == 0L) return 0.0
    val value = mantissa.toULong().toDouble() * 2.0.pow(exponent - 16383 - 63)
    return if (b.u8(i) and 0x80 != 0) -value else value
  }
}
