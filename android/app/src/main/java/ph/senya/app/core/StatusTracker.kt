package ph.senya.app.core

/** What the translator screen tells the signer about the current frame (M2 mockup). */
sealed class TranslatorStatus {
    object NoHand : TranslatorStatus() {
        override fun toString() = "NoHand"
    }
    /** A static letter clear enough to be added if the signer holds it. */
    data class Holding(val label: String, val confidence: Float) : TranslatorStatus()
    /** A hand is visible but no letter clears the commit threshold, so nothing will be added. */
    data class Unsure(val confidence: Float) : TranslatorStatus()
    object Recording : TranslatorStatus() {
        override fun toString() = "Recording"
    }
    /** A motion letter (J, Z) was just added; kept on screen briefly so the signer sees it. */
    data class AddedMotion(val label: String, val confidence: Float) : TranslatorStatus()
}

/** Turns per-frame engine output into a [TranslatorStatus] that doesn't flicker. No Android imports. */
class StatusTracker(
    private val minConfidence: Float = 0.7f,
    /** Low confidence shows "Not sure" only after this long, so single bad frames between good ones don't. */
    private val unsureAfterMs: Long = 300,
    private val motionShownMs: Long = 1000,
) {
    private var last: TranslatorStatus = TranslatorStatus.NoHand
    private var unsureSinceMs: Long? = null
    private var motion: TranslatorStatus.AddedMotion? = null
    private var motionUntilMs = 0L

    fun onFrame(tMs: Long, handPresent: Boolean, out: FrameOutput): TranslatorStatus {
        val motionGuess = out.motionGuess
        if (motionGuess != null && out.events.any { it.committedLabel() == motionGuess.label }) {
            motion = TranslatorStatus.AddedMotion(motionGuess.label, motionGuess.confidence)
            motionUntilMs = tMs + motionShownMs
        }
        val shown = motion
        if (shown != null && tMs < motionUntilMs) return remember(shown)
        motion = null
        if (!handPresent) return remember(TranslatorStatus.NoHand)
        if (out.moving) return remember(TranslatorStatus.Recording)
        val guess = out.staticGuess
        if (guess != null && guess.confidence >= minConfidence) {
            return remember(TranslatorStatus.Holding(guess.label, guess.confidence))
        }
        val since = unsureSinceMs ?: tMs.also { unsureSinceMs = it }
        if (tMs - since < unsureAfterMs) return last
        return remember(TranslatorStatus.Unsure(guess?.confidence ?: 0f), keepUnsureClock = true)
    }

    private fun remember(status: TranslatorStatus, keepUnsureClock: Boolean = false): TranslatorStatus {
        if (!keepUnsureClock) unsureSinceMs = null
        last = status
        return status
    }

    private fun StabilizerEvent.committedLabel(): String? = when (this) {
        is StabilizerEvent.Letter -> label
        is StabilizerEvent.ReplaceLast -> label
        is StabilizerEvent.Space -> null
    }
}
