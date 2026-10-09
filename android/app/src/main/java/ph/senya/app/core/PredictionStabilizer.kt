package ph.senya.app.core

/** Turns noisy per-frame guesses into committed letters and spaces (spec §5.2). No Android imports. */
class PredictionStabilizer(
    private val minConfidence: Float = 0.7f,
    private val windowSize: Int = 10,
    private val votesToCommit: Int = 8,
    private val spaceAfterMs: Long = 1000,
) {
    private val window = ArrayDeque<String?>()
    /** The last static letter; it can't be committed again until another commit or a no-hand frame. */
    private var lastStatic: String? = null
    private var noHandSinceMs: Long? = null
    private var spaceEmittedThisGap = false
    /** True at the start and right after a space: a space must not be emitted then. */
    private var outputEmptyOrSpace = true

    fun onFrame(tMs: Long, guess: Prediction?, handPresent: Boolean, moving: Boolean): StabilizerEvent? {
        if (!handPresent) return onNoHand(tMs)
        noHandSinceMs = null
        spaceEmittedThisGap = false
        if (moving) {
            window.clear()
            return null
        }
        window.addLast(guess?.takeIf { it.confidence >= minConfidence }?.label)
        while (window.size > windowSize) window.removeFirst()

        val top = window.filterNotNull().groupingBy { it }.eachCount().maxByOrNull { it.value } ?: return null
        if (top.value < votesToCommit || top.key == lastStatic) return null
        window.clear()
        lastStatic = top.key
        return emit(StabilizerEvent.Letter(top.key))
    }

    /** Call after the user edits the transcript (Backspace / Clear). */
    fun syncWithTranscript(emptyOrEndsWithSpace: Boolean) {
        outputEmptyOrSpace = emptyOrEndsWithSpace
        lastStatic = null
        window.clear()
    }

    private fun onNoHand(tMs: Long): StabilizerEvent? {
        window.clear()
        lastStatic = null
        val since = noHandSinceMs ?: tMs.also { noHandSinceMs = it }
        if (spaceEmittedThisGap || outputEmptyOrSpace || tMs - since < spaceAfterMs) return null
        spaceEmittedThisGap = true
        return emit(StabilizerEvent.Space)
    }

    private fun emit(event: StabilizerEvent): StabilizerEvent {
        outputEmptyOrSpace = event is StabilizerEvent.Space
        return event
    }
}
