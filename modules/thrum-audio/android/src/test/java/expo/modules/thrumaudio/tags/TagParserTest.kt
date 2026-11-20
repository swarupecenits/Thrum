package expo.modules.thrumaudio.tags

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayOutputStream
import java.util.zip.Deflater
import kotlin.random.Random

class TagParserTest {
  // region builders

  private class Bytes {
    private val out = ByteArrayOutputStream()
    fun u8(v: Int) = apply { out.write(v and 0xFF) }
    fun be16(v: Int) = apply { u8(v shr 8).u8(v) }
    fun be24(v: Int) = apply { u8(v shr 16).u8(v shr 8).u8(v) }
    fun be32(v: Long) = apply { u8((v shr 24).toInt()).u8((v shr 16).toInt()).u8((v shr 8).toInt()).u8(v.toInt()) }
    fun le16(v: Int) = apply { u8(v).u8(v shr 8) }
    fun le32(v: Long) = apply { u8(v.toInt()).u8((v shr 8).toInt()).u8((v shr 16).toInt()).u8((v shr 24).toInt()) }
    fun ascii(s: String) = apply { out.write(s.toByteArray(Charsets.ISO_8859_1)) }
    fun utf8(s: String) = apply { out.write(s.toByteArray(Charsets.UTF_8)) }
    fun raw(b: ByteArray) = apply { out.write(b) }
    fun zeros(n: Int) = apply { out.write(ByteArray(n)) }
    fun build(): ByteArray = out.toByteArray()
  }

  private fun bytes(block: Bytes.() -> Unit) = Bytes().apply(block).build()

  private fun parse(data: ByteArray) = Tags().also { TagParser.parse(BytesSource(data), it) }

  private fun synchsafe(v: Int) = bytes { u8(v shr 21 and 0x7F).u8(v shr 14 and 0x7F).u8(v shr 7 and 0x7F).u8(v and 0x7F) }

  private fun id3(major: Int, body: ByteArray, flags: Int = 0) = bytes {
    ascii("ID3").u8(major).u8(0).u8(flags).raw(synchsafe(body.size)).raw(body)
  }

  private fun frame(major: Int, id: String, body: ByteArray, flags: Int = 0) = bytes {
    ascii(id)
    when (major) {
      2 -> be24(body.size)
      3 -> be32(body.size.toLong())
      else -> raw(synchsafe(body.size))
    }
    if (major > 2) be16(flags)
    raw(body)
  }

  private fun encode(s: String, enc: Int, terminate: Boolean): ByteArray {
    val text = when (enc) {
      0 -> s.toByteArray(Charsets.ISO_8859_1)
      1 -> byteArrayOf(0xFF.toByte(), 0xFE.toByte()) + s.toByteArray(Charsets.UTF_16LE)
      2 -> s.toByteArray(Charsets.UTF_16BE)
      else -> s.toByteArray(Charsets.UTF_8)
    }
    return if (!terminate) text else text + ByteArray(if (enc == 1 || enc == 2) 2 else 1)
  }

  private fun uslt(text: String, enc: Int = 3, descriptor: String = "") = bytes {
    u8(enc).ascii("eng").raw(encode(descriptor, enc, true)).raw(encode(text, enc, false))
  }

  private fun sylt(items: List<Pair<String, Long>>, enc: Int = 3) = bytes {
    u8(enc).ascii("eng").u8(2).u8(1).raw(encode("", enc, true))
    for ((text, ms) in items) raw(encode(text, enc, true)).be32(ms)
  }

  private fun txxx(key: String, value: String, enc: Int = 3) = bytes {
    u8(enc).raw(encode(key, enc, true)).raw(encode(value, enc, false))
  }

  private fun unsync(b: ByteArray) = bytes {
    for (x in b) {
      u8(x.toInt())
      if (x.toInt() and 0xFF == 0xFF) u8(0)
    }
  }

  /** MPEG-1 Layer III frame headers, as after an ID3 tag. */
  private fun mp3Audio() = bytes { repeat(4) { u8(0xFF).u8(0xFB).u8(0x90).u8(0x64).zeros(413) } }

  private fun vorbisComments(vendor: String, entries: List<String>) = bytes {
    val v = vendor.toByteArray(Charsets.UTF_8)
    le32(v.size.toLong()).raw(v).le32(entries.size.toLong())
    for (e in entries) {
      val b = e.toByteArray(Charsets.UTF_8)
      le32(b.size.toLong()).raw(b)
    }
  }

  private fun streamInfo(rate: Int, channels: Int, bits: Int) = ByteArray(34).also {
    it[10] = (rate shr 12).toByte()
    it[11] = (rate shr 4).toByte()
    it[12] = ((rate and 0xF shl 4) or (channels - 1 shl 1) or (bits - 1 shr 4)).toByte()
    it[13] = (bits - 1 and 0xF shl 4).toByte()
  }

  private fun flac(blocks: List<Pair<Int, ByteArray>>, audio: Int) = bytes {
    ascii("fLaC")
    for ((i, block) in blocks.withIndex()) {
      u8(block.first or if (i == blocks.size - 1) 0x80 else 0).be24(block.second.size).raw(block.second)
    }
    zeros(audio)
  }

  private fun oggPage(serial: Long, seq: Long, type: Int, lacing: List<Int>, data: ByteArray) = bytes {
    ascii("OggS").u8(0).u8(type).zeros(8).le32(serial).le32(seq).zeros(4).u8(lacing.size)
    lacing.forEach { u8(it) }
    raw(data)
  }

  /** Each packet starts a page; long packets continue over as many pages as they need. */
  private fun ogg(serial: Long, packets: List<ByteArray>, foreignPage: Boolean = false): ByteArray {
    val out = Bytes()
    var seq = 0L
    for ((index, packet) in packets.withIndex()) {
      val lacing = ArrayList<Int>()
      var left = packet.size
      while (left >= 255) {
        lacing += 255
        left -= 255
      }
      lacing += left
      var pos = 0
      for ((c, chunk) in lacing.chunked(255).withIndex()) {
        val len = chunk.sum()
        val type = (if (c > 0) 1 else 0) or (if (index == 0 && c == 0) 2 else 0)
        out.raw(oggPage(serial, seq++, type, chunk, packet.copyOfRange(pos, pos + len)))
        pos += len
        // A page from another multiplexed stream must not leak into this one.
        if (foreignPage && index == 1 && c == 0) out.raw(oggPage(serial + 1, 0, 2, listOf(5), "OTHER".toByteArray()))
      }
    }
    return out.build()
  }

  private fun box(type: String, body: ByteArray) = bytes { be32(8L + body.size).ascii(type).raw(body) }

  private fun fullBox(type: String, body: ByteArray) = box(type, ByteArray(4) + body)

  private fun dataBox(text: String) = box("data", bytes { be32(1).be32(0).utf8(text) })

  private fun apeItem(key: String, value: ByteArray, binary: Boolean = false) = bytes {
    le32(value.size.toLong()).le32(if (binary) 2 else 0).ascii(key).u8(0).raw(value)
  }

  // endregion

  @Test
  fun id3v23PlainLyricsAndReplayGain() {
    val tag = id3(
      3,
      frame(3, "TIT2", bytes { u8(0).ascii("Song") }) +
        frame(3, "USLT", uslt("Line one\r\nLine two", enc = 1, descriptor = "desc")) +
        frame(3, "TXXX", txxx("REPLAYGAIN_TRACK_GAIN", "-6.54 dB", enc = 1)) +
        frame(3, "TXXX", txxx("replaygain_track_peak", "0.988123", enc = 0)) +
        ByteArray(64),
    )
    val tags = parse(tag + mp3Audio())
    assertEquals("Line one\nLine two" to false, tags.lyrics())
    assertEquals(-6.54, tags.trackGain!!, 1e-9)
    assertEquals(0.988123, tags.trackPeak!!, 1e-9)
    assertEquals("MP3", tags.codec)
  }

  @Test
  fun id3v24SyncedLyricsBecomeLrcAndWin() {
    val plain = "words ".repeat(40).trim() // > 127 bytes, so the synchsafe size matters
    val tags = parse(
      id3(
        4,
        frame(4, "USLT", uslt(plain)) +
          frame(4, "SYLT", sylt(listOf("First line" to 1_000L, "Second line" to 12_345L, "Third" to 75_010L))),
      ),
    )
    assertEquals("[00:01.00]First line\n[00:12.34]Second line\n[01:15.01]Third" to true, tags.lyrics())
  }

  @Test
  fun syllableTimedSyltJoinsIntoLines() {
    val items = listOf("\nHel" to 0L, "lo " to 400L, "you" to 800L, "\nWorld" to 2_000L)
    val tags = parse(id3(3, frame(3, "SYLT", sylt(items, enc = 1))))
    assertEquals("[00:00.00]Hello you\n[00:02.00]World" to true, tags.lyrics())
  }

  @Test
  fun id3v22ShortFrames() {
    val tags = parse(id3(2, frame(2, "ULT", uslt("old school", enc = 0)) + frame(2, "TXX", txxx("REPLAYGAIN_ALBUM_GAIN", "-3 dB"))))
    assertEquals("old school", tags.lyrics().first)
    assertEquals(-3.0, tags.albumGain!!, 1e-9)
  }

  @Test
  fun id3v24ToleratesPlainIntegerFrameSizes() {
    // Some writers put ordinary integers where v2.4 wants synchsafe ones.
    val text = "la ".repeat(84) + "end"
    val body = uslt(text, enc = 0)
    val broken = bytes { ascii("USLT").be32(body.size.toLong()).be16(0).raw(body) }
    val tags = parse(id3(4, broken + frame(4, "TXXX", txxx("REPLAYGAIN_ALBUM_GAIN", "-8.20 dB"))))
    assertEquals(text, tags.lyrics().first)
    assertEquals(-8.2, tags.albumGain!!, 1e-9)
  }

  @Test
  fun id3v23WholeTagUnsynchronisation() {
    val text = "Caf\u00e9 \u00ff\u00e0 \u00ff\u00ff end"
    val tags = parse(id3(3, unsync(frame(3, "USLT", uslt(text, enc = 0))), flags = 0x80) + mp3Audio())
    assertEquals(text, tags.lyrics().first)
  }

  @Test
  fun id3v24CompressedFrameWithLengthIndicator() {
    val text = "compressed words ".repeat(20).trim()
    val plain = uslt(text)
    val deflater = Deflater()
    deflater.setInput(plain)
    deflater.finish()
    val buf = ByteArray(4096)
    val n = deflater.deflate(buf)
    deflater.end()
    val tags = parse(id3(4, frame(4, "USLT", synchsafe(plain.size) + buf.copyOf(n), flags = 0x0009)))
    assertEquals(text, tags.lyrics().first)
  }

  @Test
  fun flacStreamInfoAndVorbisComments() {
    val comments = vorbisComments(
      "reference libFLAC 1.4.3",
      listOf(
        "TITLE=Thrum",
        "LYRICS=[00:01.00]one\n[00:02.50]two",
        "REPLAYGAIN_ALBUM_GAIN=-7.10 dB",
        "replaygain_track_gain=-6.00 dB",
      ),
    )
    val file = flac(listOf(0 to streamInfo(96_000, 2, 24), 6 to ByteArray(10_000), 4 to comments), audio = 1_000)
    for (data in listOf(file, id3(3, frame(3, "TIT2", bytes { u8(0).ascii("x") })) + file)) {
      val tags = parse(data)
      assertEquals("FLAC", tags.codec)
      assertEquals(96_000, tags.sampleRate)
      assertEquals(2, tags.channels)
      assertEquals(24, tags.bitDepth)
      assertEquals(1_000L, tags.audioBytes)
      assertEquals(-7.1, tags.albumGain!!, 1e-9)
      assertEquals(-6.0, tags.trackGain!!, 1e-9)
      assertEquals("[00:01.00]one\n[00:02.50]two" to true, tags.lyrics())
    }
  }

  @Test
  fun oggOpusCommentsAcrossPagesWithR128() {
    val head = bytes { ascii("OpusHead").u8(1).u8(2).le16(312).le32(44_100).le16(0).u8(0) }
    val picture = "METADATA_BLOCK_PICTURE=" + "A".repeat(70_000) // forces the packet over 2 pages
    val comments = bytes { ascii("OpusTags").raw(vorbisComments("libopus 1.5", listOf(picture, "R128_TRACK_GAIN=-2560", "LYRICS=just words"))) }
    val tags = parse(ogg(0x1234, listOf(head, comments, ByteArray(300)), foreignPage = true))
    assertEquals("Opus", tags.codec)
    assertEquals(48_000, tags.sampleRate)
    assertEquals(2, tags.channels)
    assertEquals(-5.0, tags.trackGain!!, 1e-9) // -10 dB vs -23 LUFS = -5 dB vs ReplayGain's -18
    assertEquals("just words" to false, tags.lyrics())
  }

  @Test
  fun oggVorbisHeaders() {
    val ident = bytes { u8(1).ascii("vorbis").le32(0).u8(2).le32(44_100).le32(0).le32(160_000).le32(0).u8(0xB8).u8(1) }
    val comments = bytes {
      u8(3).ascii("vorbis")
      raw(vorbisComments("Xiph.Org libVorbis", listOf("UNSYNCEDLYRICS=hello\r\nthere", "REPLAYGAIN_TRACK_GAIN=+1.50 dB")))
      u8(1)
    }
    val tags = parse(ogg(7, listOf(ident, comments, ByteArray(100))))
    assertEquals("Vorbis", tags.codec)
    assertEquals(44_100, tags.sampleRate)
    assertEquals(2, tags.channels)
    assertEquals(1.5, tags.trackGain!!, 1e-9)
    assertEquals("hello\nthere", tags.lyrics().first)
  }

  @Test
  fun mp4LyricsFreeformGainAndAlacEntry() {
    val items = box(
      "ilst",
      box("\u00a9lyr", dataBox("Line one\nLine two")) +
        box(
          "----",
          fullBox("mean", "com.apple.iTunes".toByteArray()) +
            fullBox("name", "replaygain_track_gain".toByteArray()) +
            dataBox("-3.21 dB"),
        ),
    )
    val hdlr = fullBox("hdlr", bytes { be32(0).ascii("mdir").ascii("appl").zeros(9) })
    val entry = box("alac", bytes { zeros(6).be16(1).zeros(8).be16(2).be16(24).be16(0).be16(0).be32(44_100L shl 16) })
    val trak = box("trak", box("mdia", box("minf", box("stbl", fullBox("stsd", bytes { be32(1).raw(entry) })))))
    val ftyp = box("ftyp", bytes { ascii("M4A ").be32(0).ascii("M4A isom") })
    val iso = ftyp + box("moov", trak + box("udta", fullBox("meta", hdlr + items))) + box("mdat", ByteArray(5_000))
    // QuickTime writers put a plain (not full-box) meta straight into moov.
    val quickTime = ftyp + box("moov", box("meta", hdlr + items) + trak) + box("mdat", ByteArray(5_000))
    for (file in listOf(iso, quickTime)) {
      val tags = parse(file)
      assertEquals("Line one\nLine two", tags.lyrics().first)
      assertEquals(-3.21, tags.trackGain!!, 1e-9)
      assertEquals("ALAC", tags.codec)
      assertEquals(2, tags.channels)
      assertEquals(24, tags.bitDepth)
      assertEquals(5_000L, tags.audioBytes)
    }
  }

  @Test
  fun apeTagBeforeId3v1() {
    val items = apeItem("REPLAYGAIN_TRACK_GAIN", "-4.00 dB".toByteArray()) +
      apeItem("Cover Art (Front)", ByteArray(3_000), binary = true) +
      apeItem("Lyrics", "hello ape".toByteArray())
    val footer = bytes { ascii("APETAGEX").le32(2000).le32(items.size + 32L).le32(3).le32(0).zeros(8) }
    val id3v1 = bytes { ascii("TAG").zeros(125) }
    val tags = parse(mp3Audio() + items + footer + id3v1)
    assertEquals(-4.0, tags.trackGain!!, 1e-9)
    assertEquals("hello ape", tags.lyrics().first)
    assertEquals("MP3", tags.codec)
  }

  @Test
  fun waveExtensibleWithPaddedChunksAndId3() {
    val fmt = bytes {
      le16(0xFFFE).le16(2).le32(48_000).le32(48_000L * 6).le16(6).le16(24).le16(22).le16(20).le32(3).le16(1).zeros(14)
    }
    val tag = id3(3, frame(3, "TXXX", txxx("REPLAYGAIN_TRACK_GAIN", "-2.00 dB")))
    val body = bytes {
      ascii("WAVE").ascii("fmt ").le32(fmt.size.toLong()).raw(fmt)
      ascii("data").le32(6_001).zeros(6_001).u8(0) // odd chunks are padded to even
      ascii("id3 ").le32(tag.size.toLong()).raw(tag)
    }
    val tags = parse(bytes { ascii("RIFF").le32(body.size.toLong()).raw(body) })
    assertEquals("PCM", tags.codec)
    assertEquals(48_000, tags.sampleRate)
    assertEquals(2, tags.channels)
    assertEquals(20, tags.bitDepth)
    assertEquals(6_001L, tags.audioBytes)
    assertEquals(-2.0, tags.trackGain!!, 1e-9)
  }

  @Test
  fun aiffCommonChunk() {
    val rate44k = byteArrayOf(0x40, 0x0E, 0xAC.toByte(), 0x44, 0, 0, 0, 0, 0, 0)
    val comm = bytes { be16(2).be32(1_000).be16(16).raw(rate44k) }
    val body = bytes {
      ascii("AIFF").ascii("COMM").be32(comm.size.toLong()).raw(comm)
      ascii("SSND").be32(8L + 4_000).be32(0).be32(0).zeros(4_000)
    }
    val tags = parse(bytes { ascii("FORM").be32(body.size.toLong()).raw(body) })
    assertEquals("PCM", tags.codec)
    assertEquals(44_100, tags.sampleRate)
    assertEquals(2, tags.channels)
    assertEquals(16, tags.bitDepth)
    assertEquals(4_000L, tags.audioBytes)
  }

  @Test
  fun lyricChoiceAndValueParsing() {
    val t = Tags()
    t.addLyrics("a much longer plain lyric text that goes on and on and on")
    t.field("SYNCEDLYRICS", "\uFEFF[00:01.00]one\r\n[00:02.00]two")
    assertEquals("[00:01.00]one\n[00:02.00]two" to true, t.lyrics())

    t.field("REPLAYGAIN_TRACK_GAIN", "-1 dB")
    t.field("replaygain_track_gain", "-9 dB")
    assertEquals(-1.0, t.trackGain!!, 1e-9) // the first value wins

    assertEquals(-6.5, Tags.parseGain("\u22126,5 dB")!!, 1e-9)
    assertNull(Tags.parseGain("-99 dB"))
    assertNull(Tags.parseGain("loud"))
    assertNull(Tags.parsePeak("0"))
    assertEquals(-5.0, Tags.parseR128("-2560")!!, 1e-9)
    assertNull(Tags.parseR128("1.5"))
    assertFalse(Tags.isLrc("[ar:Someone]\n[ti:Song]\nplain words\nmore words"))
    assertTrue(Tags.isLrc("[01:02.03][01:30.00]a chorus sung twice"))
    assertTrue(Tags().apply { addLyrics(" \u0000 ") }.lyrics().first == null)
  }

  @Test(timeout = 60_000)
  fun corruptFilesNeverThrowOrHang() {
    val seeds = listOf(
      id3(3, frame(3, "USLT", uslt("hello", enc = 1)) + frame(3, "SYLT", sylt(listOf("a" to 1L, "b" to 2L)))) + mp3Audio(),
      id3(4, frame(4, "USLT", synchsafe(20) + ByteArray(30), flags = 0x0009)),
      id3(3, unsync(frame(3, "TXXX", txxx("REPLAYGAIN_TRACK_GAIN", "\u00ff-1 dB", enc = 0))), flags = 0xC0),
      flac(listOf(0 to streamInfo(44_100, 2, 16), 4 to vorbisComments("v", listOf("LYRICS=x"))), audio = 64),
      ogg(9, listOf(bytes { ascii("OpusHead").u8(1).u8(2).zeros(9) }, bytes { ascii("OpusTags").raw(vorbisComments("v", listOf("LYRICS=y"))) })),
      box("ftyp", bytes { ascii("M4A ") }) + box("moov", box("udta", fullBox("meta", box("ilst", box("\u00a9lyr", dataBox("z")))))),
      mp3Audio() + apeItem("Lyrics", "q".toByteArray()) + bytes { ascii("APETAGEX").le32(2000).le32(48).le32(1).le32(0).zeros(8) },
      bytes { ascii("RIFF").le32(40).ascii("WAVEfmt ").le32(16).le16(1).le16(2).le32(44_100).le32(0).le16(4).le16(16) },
      bytes { ascii("FORM").le32(30).ascii("AIFCCOMM").be32(22).be16(2).be32(1).be16(16).zeros(10).ascii("sowt") },
    )
    val random = Random(1234)
    repeat(3_000) { i ->
      val data = seeds[i % seeds.size].copyOf()
      repeat(1 + random.nextInt(6)) { data[random.nextInt(data.size)] = random.nextInt(256).toByte() }
      val cut = data.copyOf(random.nextInt(data.size + 1))
      TagParser.parse(BytesSource(cut), Tags())
    }
    repeat(300) { TagParser.parse(BytesSource(Random(it).nextBytes(Random(it).nextInt(2_048))), Tags()) }
  }
}
