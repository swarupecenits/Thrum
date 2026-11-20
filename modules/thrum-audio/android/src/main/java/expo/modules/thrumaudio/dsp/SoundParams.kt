package expo.modules.thrumaudio.dsp

import org.json.JSONArray
import org.json.JSONObject

/**
 * Everything the listener can tune. Immutable; the audio thread picks up a new instance through
 * [DspEngine.update]. Values are always sanitized so a bad map from JS can never produce NaN audio.
 */
data class SoundParams(
  val enabled: Boolean = true,
  val preampDb: Float = 0f,
  val autoHeadroom: Boolean = true,
  val bands: List<Float> = List(BAND_COUNT) { 0f },
  val bassDb: Float = 0f,
  val bassFreq: Float = 80f,
  val phantom: Float = 0f,
  val rumble: Boolean = true,
  val trebleDb: Float = 0f,
  val width: Float = 1f,
  val balance: Float = 0f,
  val limiter: Boolean = true,
) {
  fun sanitized(): SoundParams = SoundParams(
    enabled = enabled,
    preampDb = clean(preampDb, 0f, PREAMP_MIN, PREAMP_MAX),
    autoHeadroom = autoHeadroom,
    bands = if (bands.size == BAND_COUNT) bands.map { clean(it, 0f, BAND_MIN, BAND_MAX) } else List(BAND_COUNT) { 0f },
    bassDb = clean(bassDb, 0f, 0f, BASS_MAX),
    bassFreq = clean(bassFreq, 80f, BASS_FREQ_MIN, BASS_FREQ_MAX),
    phantom = clean(phantom, 0f, 0f, 1f),
    rumble = rumble,
    trebleDb = clean(trebleDb, 0f, TREBLE_MIN, TREBLE_MAX),
    width = clean(width, 1f, 0f, 2f),
    balance = clean(balance, 0f, -1f, 1f),
    limiter = limiter,
  )

  fun toMap(): Map<String, Any?> = mapOf(
    "enabled" to enabled,
    "preampDb" to preampDb.toDouble(),
    "autoHeadroom" to autoHeadroom,
    "bands" to bands.map { it.toDouble() },
    "bassDb" to bassDb.toDouble(),
    "bassFreq" to bassFreq.toDouble(),
    "phantom" to phantom.toDouble(),
    "rumble" to rumble,
    "trebleDb" to trebleDb.toDouble(),
    "width" to width.toDouble(),
    "balance" to balance.toDouble(),
    "limiter" to limiter,
  )

  fun toJson(): String = JSONObject().apply {
    put("enabled", enabled)
    put("preampDb", preampDb.toDouble())
    put("autoHeadroom", autoHeadroom)
    put("bands", JSONArray().apply { bands.forEach { put(it.toDouble()) } })
    put("bassDb", bassDb.toDouble())
    put("bassFreq", bassFreq.toDouble())
    put("phantom", phantom.toDouble())
    put("rumble", rumble)
    put("trebleDb", trebleDb.toDouble())
    put("width", width.toDouble())
    put("balance", balance.toDouble())
    put("limiter", limiter)
  }.toString()

  companion object {
    const val BAND_COUNT = 10
    const val PREAMP_MIN = -12f
    const val PREAMP_MAX = 6f
    const val BAND_MIN = -12f
    const val BAND_MAX = 12f
    const val BASS_MAX = 12f
    const val BASS_FREQ_MIN = 40f
    const val BASS_FREQ_MAX = 150f
    const val TREBLE_MIN = -6f
    const val TREBLE_MAX = 6f

    /** Graphic EQ centres in Hz, mirrored by the JS curve renderer. */
    val BAND_FREQS = floatArrayOf(31f, 62f, 125f, 250f, 500f, 1000f, 2000f, 4000f, 8000f, 16000f)

    /** Neutral: no colouration, safety features on. */
    val FLAT = SoundParams()

    /** Thrum's signature tuning: warm, deep low end with a little air on top. */
    val THRUM_DEFAULT = SoundParams(
      bands = listOf(2.5f, 2f, 0.5f, 0f, 0f, 0f, 0f, 0.5f, 1f, 1.5f),
      bassDb = 4f,
      bassFreq = 80f,
      phantom = 0.15f,
    )

    /** Partial update from JS: missing keys keep the value from [base]. */
    fun fromMap(map: Map<String, Any?>, base: SoundParams): SoundParams = SoundParams(
      enabled = bool(map["enabled"]) ?: base.enabled,
      preampDb = num(map["preampDb"]) ?: base.preampDb,
      autoHeadroom = bool(map["autoHeadroom"]) ?: base.autoHeadroom,
      bands = floats(map["bands"]) ?: base.bands,
      bassDb = num(map["bassDb"]) ?: base.bassDb,
      bassFreq = num(map["bassFreq"]) ?: base.bassFreq,
      phantom = num(map["phantom"]) ?: base.phantom,
      rumble = bool(map["rumble"]) ?: base.rumble,
      trebleDb = num(map["trebleDb"]) ?: base.trebleDb,
      width = num(map["width"]) ?: base.width,
      balance = num(map["balance"]) ?: base.balance,
      limiter = bool(map["limiter"]) ?: base.limiter,
    ).sanitized()

    fun fromJson(json: String): SoundParams? = try {
      val o = JSONObject(json)
      val base = FLAT
      val bandsArray = o.optJSONArray("bands")
      val parsedBands = bandsArray?.let { arr ->
        if (arr.length() != BAND_COUNT) null else List(BAND_COUNT) { arr.optDouble(it, 0.0).toFloat() }
      }
      SoundParams(
        enabled = o.optBoolean("enabled", base.enabled),
        preampDb = o.optDouble("preampDb", base.preampDb.toDouble()).toFloat(),
        autoHeadroom = o.optBoolean("autoHeadroom", base.autoHeadroom),
        bands = parsedBands ?: base.bands,
        bassDb = o.optDouble("bassDb", base.bassDb.toDouble()).toFloat(),
        bassFreq = o.optDouble("bassFreq", base.bassFreq.toDouble()).toFloat(),
        phantom = o.optDouble("phantom", base.phantom.toDouble()).toFloat(),
        rumble = o.optBoolean("rumble", base.rumble),
        trebleDb = o.optDouble("trebleDb", base.trebleDb.toDouble()).toFloat(),
        width = o.optDouble("width", base.width.toDouble()).toFloat(),
        balance = o.optDouble("balance", base.balance.toDouble()).toFloat(),
        limiter = o.optBoolean("limiter", base.limiter),
      ).sanitized()
    } catch (_: Exception) {
      null
    }

    private fun clean(value: Float, fallback: Float, min: Float, max: Float): Float =
      if (value.isNaN() || value.isInfinite()) fallback else value.coerceIn(min, max)

    private fun num(value: Any?): Float? = when (value) {
      is Number -> value.toFloat().takeIf { !it.isNaN() && !it.isInfinite() }
      else -> null
    }

    private fun bool(value: Any?): Boolean? = value as? Boolean

    private fun floats(value: Any?): List<Float>? {
      val list: List<Any?> = when (value) {
        is List<*> -> value
        is DoubleArray -> value.toList()
        is FloatArray -> value.toList()
        is Array<*> -> value.toList()
        else -> return null
      }
      if (list.size != BAND_COUNT) return null
      return list.map { num(it) ?: return null }
    }
  }
}
