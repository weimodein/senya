package ph.senya.app.core

data class EngineModels(
    val static: StaticClassifier?,
    val motion: SequenceClassifier? = null,
    val config: MotionConfig = MotionConfig(),
)

data class FrameOutput(
    val staticGuess: Prediction?,
    val moving: Boolean,
    val motionGuess: Prediction?,
    val events: List<StabilizerEvent>,
)

/** The per-frame pipeline (spec §5.1). Thread-safe: frames, model swaps, and edits may come from different threads. */
class TranslatorEngine(models: EngineModels) {
    private val lock = Any()
    private var models = models
    private var stabilizer = newStabilizer(models.config)
    private var segmenter = MotionSegmenter(models.config)

    fun onFrame(tMs: Long, landmarks: FloatArray?): FrameOutput = synchronized(lock) {
        val guess = landmarks?.let { models.static?.classify(it) }
        val motionModel = models.motion
        val seg = if (motionModel != null) segmenter.onFrame(tMs, landmarks) else MotionSegmenter.Output(false, null)
        val motionGuess = seg.segment?.let { motionModel?.classify(it.frames) }
        val events = mutableListOf<StabilizerEvent>()
        if (seg.segment != null && motionGuess != null) {
            stabilizer.onMotion(tMs, seg.segment.startMs, motionGuess)?.let { events += it }
        }
        stabilizer.onFrame(tMs, guess, handPresent = landmarks != null, moving = seg.moving)?.let { events += it }
        FrameOutput(guess, seg.moving, motionGuess, events)
    }

    /** Swaps models and starts fresh. When this returns, no frame is still using the old models. */
    fun setModels(models: EngineModels) = synchronized(lock) {
        this.models = models
        stabilizer = newStabilizer(models.config)
        segmenter = MotionSegmenter(models.config)
    }

    fun onTranscriptEdited(emptyOrEndsWithSpace: Boolean) = synchronized(lock) {
        stabilizer.syncWithTranscript(emptyOrEndsWithSpace)
    }

    private fun newStabilizer(config: MotionConfig) = PredictionStabilizer(
        motionMinConfidence = config.minConfidence,
        replaceWindowMs = config.replaceWindowMs,
        startShapes = config.startShapes,
    )
}
