package expo.modules.thrumaudio.dsp

/**
 * Process-wide sound state shared by the UI side ([update], [setBypass], [readSpectrum]) and the
 * audio thread ([DspChain] reads [snapshot] once per block). Publishing is a single volatile write
 * of an immutable snapshot, so the audio thread never sees half an update and never locks.
 */
object DspEngine {
  internal class Snapshot(
    val params: SoundParams,
    /** Automatic headroom (<= 0 dB) for [params]; 0 when auto headroom is off. */
    val headroomDb: Float,
    val bypass: Boolean,
    val version: Int,
  )

  @Volatile
  internal var snapshot = Snapshot(SoundParams.THRUM_DEFAULT, headroomFor(SoundParams.THRUM_DEFAULT), false, 0)
    private set

  internal val tap = SpectrumTap()

  val params: SoundParams get() = snapshot.params
  val bypass: Boolean get() = snapshot.bypass

  /** Headroom currently applied (<= 0 dB). */
  val headroomDb: Float get() = snapshot.let { if (it.params.enabled) it.headroomDb else 0f }

  /** Limiter gain reduction in dB (>= 0), peak-held with a slow decay for display. */
  @Volatile
  var reductionDb: Float = 0f
    internal set

  @Synchronized
  fun update(params: SoundParams) {
    val clean = params.sanitized()
    val current = snapshot
    snapshot = Snapshot(clean, headroomFor(clean), current.bypass, current.version + 1)
  }

  @Synchronized
  fun setBypass(bypass: Boolean) {
    val current = snapshot
    if (current.bypass == bypass) return
    snapshot = Snapshot(current.params, current.headroomDb, bypass, current.version + 1)
  }

  /**
   * Visualizer frame for what is audible now. [delayFrames] is how far the newest processed sample
   * is ahead of the speaker; [nowNanos] drives the smoothing so it is frame-rate independent.
   */
  fun readSpectrum(delayFrames: Int, nowNanos: Long): SpectrumFrame? =
    tap.read(delayFrames, nowNanos, reductionDb)

  /** Lowers the preamp by 0.75x the largest boost (plus a little for phantom harmonics). */
  fun headroomFor(params: SoundParams): Float {
    if (!params.autoHeadroom) return 0f
    val boost = EqLayout.maxBoostDb(params) + PHANTOM_HEADROOM_DB * params.phantom
    val headroom = -0.75 * maxOf(0.0, boost)
    return (Math.round(headroom * 10.0) / 10.0).toFloat()
  }

  private const val PHANTOM_HEADROOM_DB = 1.5
}
