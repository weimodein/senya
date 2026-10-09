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
    private var stabilizer = PredictionStabilizer()

    fun onFrame(tMs: Long, landmarks: FloatArray?): FrameOutput = synchronized(lock) {
        val guess = landmarks?.let { models.static?.classify(it) }
        val event = stabilizer.onFrame(tMs, guess, handPresent = landmarks != null, moving = false)
        FrameOutput(guess, moving = false, motionGuess = null, events = listOfNotNull(event))
    }

    /** Swaps models and starts fresh. When this returns, no frame is still using the old models. */
    fun setModels(models: EngineModels) = synchronized(lock) {
        this.models = models
        stabilizer = PredictionStabilizer()
    }

    fun onTranscriptEdited(emptyOrEndsWithSpace: Boolean) = synchronized(lock) {
        stabilizer.syncWithTranscript(emptyOrEndsWithSpace)
    }
}
