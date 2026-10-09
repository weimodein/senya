package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PredictionStabilizerMotionTest {
    private var t = 0L

    private fun stabilizer() = PredictionStabilizer(startShapes = mapOf("J" to listOf("I"), "Z" to emptyList()))

    private fun PredictionStabilizer.hold(label: String, n: Int): List<StabilizerEvent> =
        (1..n).mapNotNull { t += 33; onFrame(t, Prediction(label, 0.9f), handPresent = true, moving = false) }

    @Test
    fun noneIsNeverCommitted() {
        assertNull(stabilizer().onMotion(1000, 500, Prediction(NONE_LABEL, 0.99f)))
    }

    @Test
    fun lowConfidenceMotionIgnored() {
        assertNull(stabilizer().onMotion(1000, 500, Prediction("J", 0.5f)))
    }

    @Test
    fun replacesStartShapeCommittedJustBefore() {
        val s = stabilizer()
        assertEquals(listOf(StabilizerEvent.Letter("I")), s.hold("I", 8)) // committed at t = 264
        assertEquals(StabilizerEvent.ReplaceLast("J"), s.onMotion(nowMs = 1500, segmentStartMs = 1000, guess = Prediction("J", 0.9f)))
    }

    @Test
    fun keepsStartShapeCommittedLongBefore() {
        val s = stabilizer()
        s.hold("I", 8) // t = 264
        assertEquals(StabilizerEvent.Letter("J"), s.onMotion(nowMs = 3000, segmentStartMs = 2000, guess = Prediction("J", 0.9f)))
    }

    @Test
    fun doesNotReplaceOtherLetters() {
        val s = stabilizer()
        s.hold("A", 8)
        assertEquals(StabilizerEvent.Letter("J"), s.onMotion(600, 400, Prediction("J", 0.9f)))
    }

    @Test
    fun twoSegmentsGiveTwoLetters() {
        val s = stabilizer()
        assertEquals(StabilizerEvent.Letter("Z"), s.onMotion(1000, 500, Prediction("Z", 0.9f)))
        assertEquals(StabilizerEvent.Letter("Z"), s.onMotion(2500, 2000, Prediction("Z", 0.9f)))
    }

    @Test
    fun startShapeHeldAfterMotionIsNotCommitted() {
        val s = stabilizer()
        t = 1000
        s.onMotion(t, 500, Prediction("J", 0.9f))
        assertEquals(emptyList<StabilizerEvent>(), s.hold("I", 20))
        t += 33
        s.onFrame(t, null, handPresent = false, moving = false)
        assertEquals(listOf(StabilizerEvent.Letter("I")), s.hold("I", 8))
    }

    @Test
    fun otherLetterAllowedRightAfterMotion() {
        val s = stabilizer()
        t = 1000
        s.onMotion(t, 500, Prediction("J", 0.9f))
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hold("A", 8))
    }

    @Test
    fun noReplaceAcrossSpace() {
        val s = stabilizer()
        s.hold("I", 8)
        repeat(40) { t += 33; s.onFrame(t, null, handPresent = false, moving = false) } // space committed
        assertEquals(StabilizerEvent.Letter("J"), s.onMotion(t + 100, t, Prediction("J", 0.9f)))
    }
}
