package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Test

class StatusTrackerTest {
    private fun out(
        guess: Prediction? = null,
        moving: Boolean = false,
        motion: Prediction? = null,
        events: List<StabilizerEvent> = emptyList(),
    ) = FrameOutput(guess, moving, motion, events)

    private val a = Prediction("A", 0.9f)
    private val weak = Prediction("B", 0.42f)

    @Test
    fun noHand() {
        assertEquals(TranslatorStatus.NoHand, StatusTracker().onFrame(0, false, out()))
    }

    @Test
    fun confidentLetterIsHolding() {
        assertEquals(TranslatorStatus.Holding("A", 0.9f), StatusTracker().onFrame(0, true, out(a)))
    }

    @Test
    fun briefLowConfidenceKeepsPreviousStatus() {
        val t = StatusTracker()
        t.onFrame(0, true, out(a))
        assertEquals(TranslatorStatus.Holding("A", 0.9f), t.onFrame(33, true, out(weak)))
        assertEquals(TranslatorStatus.Holding("A", 0.9f), t.onFrame(300, true, out(weak)))
        assertEquals(TranslatorStatus.Unsure(0.42f), t.onFrame(333, true, out(weak)))
    }

    @Test
    fun goodFrameRestartsUnsureClock() {
        val t = StatusTracker()
        t.onFrame(0, true, out(weak))
        t.onFrame(200, true, out(a))
        assertEquals(TranslatorStatus.Holding("A", 0.9f), t.onFrame(400, true, out(weak)))
        assertEquals(TranslatorStatus.Unsure(0.42f), t.onFrame(700, true, out(weak)))
    }

    @Test
    fun handWithoutStaticGuessBecomesUnsure() {
        val t = StatusTracker()
        t.onFrame(0, true, out(null))
        assertEquals(TranslatorStatus.Unsure(0f), t.onFrame(300, true, out(null)))
    }

    @Test
    fun movingIsRecording() {
        assertEquals(TranslatorStatus.Recording, StatusTracker().onFrame(0, true, out(a, moving = true)))
    }

    @Test
    fun addedMotionLetterStaysOneSecond() {
        val t = StatusTracker()
        val j = Prediction("J", 0.88f)
        assertEquals(TranslatorStatus.AddedMotion("J", 0.88f),
            t.onFrame(1000, true, out(motion = j, events = listOf(StabilizerEvent.Letter("J")))))
        assertEquals(TranslatorStatus.AddedMotion("J", 0.88f), t.onFrame(1500, false, out()))
        assertEquals(TranslatorStatus.NoHand, t.onFrame(2000, false, out()))
    }

    @Test
    fun replaceLastCountsAsAdded() {
        val j = Prediction("J", 0.8f)
        assertEquals(TranslatorStatus.AddedMotion("J", 0.8f),
            StatusTracker().onFrame(0, true, out(motion = j, events = listOf(StabilizerEvent.ReplaceLast("J")))))
    }

    @Test
    fun rejectedMotionIsNotShown() {
        val none = Prediction(NONE_LABEL, 0.9f)
        assertEquals(TranslatorStatus.Holding("A", 0.9f), StatusTracker().onFrame(0, true, out(a, motion = none)))
    }

    @Test
    fun staticCommitDuringMotionGuessIsNotAMotionLetter() {
        val j = Prediction("J", 0.9f)
        assertEquals(TranslatorStatus.Holding("A", 0.9f),
            StatusTracker().onFrame(0, true, out(a, motion = j, events = listOf(StabilizerEvent.Letter("A")))))
    }
}
