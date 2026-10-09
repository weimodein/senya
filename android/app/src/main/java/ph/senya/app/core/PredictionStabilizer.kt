package ph.senya.app.core

/** Turns noisy per-frame guesses into committed letters and spaces (spec §5.2). No Android imports. */
class PredictionStabilizer(
    private val minConfidence: Float = 0.7f,
    private val windowSize: Int = 10,
    private val votesToCommit: Int = 8,
    private val spaceAfterMs: Long = 1000,
    private val motionMinConfidence: Float = 0.7f,
    private val replaceWindowMs: Long = 1000,
    /** Static letters a motion letter starts from (motion_config.json "start_shapes"). */
    private val startShapes: Map<String, List<String>> = emptyMap(),
) {
    private val window = ArrayDeque<String?>()
    /** The last static letter; it can't be committed again until another commit or a no-hand frame. */
    private var lastStatic: String? = null
    private var noHandSinceMs: Long? = null
    private var spaceEmittedThisGap = false
    /** True at the start and right after a space: a space must not be emitted then. */
    private var outputEmptyOrSpace = true
    /** Start shapes of the last motion letter: not committed until another commit or a no-hand frame. */
    private var blocked: Set<String> = emptySet()
    /** The last letter committed, for the start-shape replacement rule; null after a space or an edit. */
    private var lastCommit: Committed? = null

    private class Committed(val label: String, val atMs: Long, val isStatic: Boolean)

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
        if (top.value < votesToCommit || top.key == lastStatic || top.key in blocked) return null
        window.clear()
        lastStatic = top.key
        blocked = emptySet()
        return emit(StabilizerEvent.Letter(top.key), tMs, isStatic = true)
    }

    /** Call when a motion segment ends and the motion model has classified it. */
    fun onMotion(nowMs: Long, segmentStartMs: Long, guess: Prediction): StabilizerEvent? {
        if (guess.label == NONE_LABEL || guess.confidence < motionMinConfidence) return null
        val shapes = startShapes[guess.label].orEmpty()
        val last = lastCommit
        val replace = last != null && last.isStatic && last.label in shapes &&
            last.atMs >= segmentStartMs - replaceWindowMs
        window.clear()
        lastStatic = null
        blocked = shapes.toSet()
        val event = if (replace) StabilizerEvent.ReplaceLast(guess.label) else StabilizerEvent.Letter(guess.label)
        return emit(event, nowMs, isStatic = false)
    }

    /** Call after the user edits the transcript (Backspace / Clear). */
    fun syncWithTranscript(emptyOrEndsWithSpace: Boolean) {
        outputEmptyOrSpace = emptyOrEndsWithSpace
        lastStatic = null
        blocked = emptySet()
        lastCommit = null
        window.clear()
    }

    private fun onNoHand(tMs: Long): StabilizerEvent? {
        window.clear()
        lastStatic = null
        blocked = emptySet()
        val since = noHandSinceMs ?: tMs.also { noHandSinceMs = it }
        if (spaceEmittedThisGap || outputEmptyOrSpace || tMs - since < spaceAfterMs) return null
        spaceEmittedThisGap = true
        return emit(StabilizerEvent.Space, tMs, isStatic = false)
    }

    private fun emit(event: StabilizerEvent, tMs: Long, isStatic: Boolean): StabilizerEvent {
        outputEmptyOrSpace = event is StabilizerEvent.Space
        lastCommit = when (event) {
            is StabilizerEvent.Letter -> Committed(event.label, tMs, isStatic)
            is StabilizerEvent.ReplaceLast -> Committed(event.label, tMs, isStatic)
            is StabilizerEvent.Space -> null
        }
        return event
    }
}
