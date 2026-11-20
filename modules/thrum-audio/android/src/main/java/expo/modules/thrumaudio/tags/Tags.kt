package expo.modules.thrumaudio.tags

import java.util.Locale

/** Everything the parsers found in one file. Text fields from every tag format go through [field]. */
internal class Tags {
  private val lyricCandidates = ArrayList<String>()
  var trackGain: Double? = null
  var albumGain: Double? = null
  var trackPeak: Double? = null
  var sampleRate: Int? = null
  var channels: Int? = null
  var bitDepth: Int? = null
  var codec: String? = null

  /** Size of the coded audio payload, for a bitrate estimate when the platform has none. */
  var audioBytes: Long? = null

  /** Keys whose values are worth reading (everything else, like embedded art, is skipped). */
  fun wants(key: String): Boolean = key.trim().uppercase(Locale.ROOT) in KEYS

  /** Routes a key/value text field from Vorbis comments, APEv2, MP4 freeform atoms or ID3 TXXX. */
  fun field(key: String, value: String) {
    when (key.trim().uppercase(Locale.ROOT)) {
      "REPLAYGAIN_TRACK_GAIN" -> trackGain = trackGain ?: parseGain(value)
      "REPLAYGAIN_ALBUM_GAIN" -> albumGain = albumGain ?: parseGain(value)
      "REPLAYGAIN_TRACK_PEAK" -> trackPeak = trackPeak ?: parsePeak(value)
      "R128_TRACK_GAIN" -> trackGain = trackGain ?: parseR128(value)
      "R128_ALBUM_GAIN" -> albumGain = albumGain ?: parseR128(value)
      in LYRIC_KEYS -> addLyrics(value)
    }
  }

  fun addLyrics(text: String) {
    val clean = normalize(text)
    if (clean.isNotBlank()) lyricCandidates += clean
  }

  /** The best lyrics found: the longest synced (LRC) text, else the longest plain one. */
  fun lyrics(): Pair<String?, Boolean> {
    val synced = lyricCandidates.filter(::isLrc).maxByOrNull { it.length }
    if (synced != null) return synced to true
    return lyricCandidates.maxByOrNull { it.length } to false
  }

  internal companion object {
    private val LYRIC_KEYS = setOf(
      "LYRICS", "LYRIC", "UNSYNCEDLYRICS", "UNSYNCED LYRICS", "UNSYNCED_LYRICS", "SYNCEDLYRICS", "SYNCED LYRICS",
      "SYNCED_LYRICS",
    )
    private val KEYS = LYRIC_KEYS + setOf(
      "REPLAYGAIN_TRACK_GAIN", "REPLAYGAIN_ALBUM_GAIN", "REPLAYGAIN_TRACK_PEAK", "R128_TRACK_GAIN", "R128_ALBUM_GAIN",
    )
    private const val MAX_LYRICS = 200_000
    private val NUMBER = Regex("""[-+\u2212]?\d+(?:[.,]\d+)?""")
    private val STAMP = Regex("""^\s*(\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?])+""")

    /** "−6.54 dB", "+1,2 dB", "-3" -> dB. ReplayGain gains outside -60..+30 dB are junk. */
    fun parseGain(value: String): Double? {
      val n = number(value) ?: return null
      return n.takeIf { it in -60.0..30.0 }
    }

    fun parsePeak(value: String): Double? {
      val n = number(value) ?: return null
      return n.takeIf { it > 0.0 && it <= 10.0 }
    }

    /**
     * Opus R128 gains are Q7.8 integers relative to -23 LUFS; +5 dB lines them up with ReplayGain's
     * -18 LUFS reference so the app can treat both the same.
     */
    fun parseR128(value: String): Double? {
      val q = value.trim().toIntOrNull() ?: return null
      if (q !in -32768..32767) return null
      return (q / 256.0 + 5.0).takeIf { it in -60.0..30.0 }
    }

    private fun number(value: String): Double? {
      val m = NUMBER.find(value) ?: return null
      return m.value.replace('\u2212', '-').replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() }
    }

    fun normalize(text: String): String {
      var t = text.replace("\uFEFF", "").replace("\u0000", "")
      t = t.replace("\r\n", "\n").replace('\r', '\n')
      t = t.lines().joinToString("\n") { it.trimEnd() }.trim('\n', ' ', '\t')
      return if (t.length > MAX_LYRICS) t.substring(0, MAX_LYRICS) else t
    }

    /** LRC when at least two lines carry [mm:ss.xx] stamps (one is enough for a one- or two-line text). */
    fun isLrc(text: String): Boolean {
      var stamped = 0
      var lines = 0
      for (line in text.lineSequence()) {
        if (line.isBlank()) continue
        lines++
        if (STAMP.containsMatchIn(line)) stamped++
      }
      return stamped >= 2 || (stamped == 1 && lines <= 2)
    }
  }
}
