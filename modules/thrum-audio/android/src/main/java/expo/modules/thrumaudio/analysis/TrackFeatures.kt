package expo.modules.thrumaudio.analysis

import kotlin.math.roundToLong

/** What the analyzer learned about one track. Mirrors `TrackFeatures` in ThrumAudio.types.ts. */
internal data class TrackFeatures(
  val bpm: Double,
  val bpmConfidence: Double,
  val energy: Double,
  val loudnessLufs: Double,
  val peak: Double,
  val dynamics: Double,
  val bass: Double,
  val subBass: Double,
  val brightness: Double,
  val flatness: Double,
  val danceability: Double,
  val valence: Double,
  val acousticness: Double,
  val key: Int,
  val mode: Int,
  val keyConfidence: Double,
  val onsetRate: Double,
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "v" to VERSION,
    "bpm" to round(bpm, 10.0),
    "bpmConfidence" to round(bpmConfidence),
    "energy" to round(energy),
    "loudnessLufs" to round(loudnessLufs, 100.0),
    "peak" to round(peak),
    "dynamics" to round(dynamics),
    "bass" to round(bass),
    "subBass" to round(subBass),
    "brightness" to round(brightness),
    "flatness" to round(flatness),
    "danceability" to round(danceability),
    "valence" to round(valence),
    "acousticness" to round(acousticness),
    "key" to key,
    "mode" to mode,
    "keyConfidence" to round(keyConfidence),
    "onsetRate" to round(onsetRate, 100.0),
  )

  companion object {
    /** Bump when the maths changes so the app re-analyzes its library. */
    const val VERSION = 1

    private fun round(value: Double, scale: Double = 1000.0): Double =
      if (value.isFinite()) (value * scale).roundToLong() / scale else 0.0
  }
}
