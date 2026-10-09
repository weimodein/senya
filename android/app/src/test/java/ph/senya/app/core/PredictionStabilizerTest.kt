package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PredictionStabilizerTest {
    private var t = 0L
    private val step = 33L

    /** Feeds [n] frames of [label] and returns the non-null events. */
    private fun PredictionStabilizer.hand(label: String?, n: Int, conf: Float = 0.9f, moving: Boolean = false): List<StabilizerEvent> =
        (1..n).mapNotNull {
            t += step
            onFrame(t, label?.let { Prediction(it, conf) }, handPresent = true, moving = moving)
        }

    private fun PredictionStabilizer.noHand(ms: Long): List<StabilizerEvent> {
        val out = mutableListOf<StabilizerEvent>()
        val end = t + ms
        while (t < end) {
            t += step
            onFrame(t, null, handPresent = false, moving = false)?.let { out += it }
        }
        return out
    }

    @Test
    fun commitsOnEighthAgreeingFrame() {
        val s = PredictionStabilizer()
        assertEquals(emptyList<StabilizerEvent>(), s.hand("A", 7))
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 1))
    }

    @Test
    fun sevenOfTenDoesNotCommit() {
        val s = PredictionStabilizer()
        val events = listOf("A", "A", "B", "A", "A", "B", "A", "A", "B", "A").flatMap { s.hand(it, 1) }
        assertEquals(emptyList<StabilizerEvent>(), events)
    }

    @Test
    fun lowConfidenceFramesDoNotVote() {
        val s = PredictionStabilizer()
        assertEquals(emptyList<StabilizerEvent>(), s.hand("A", 10, conf = 0.6f))
        assertEquals(emptyList<StabilizerEvent>(), s.hand("A", 7))
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 1))
    }

    @Test
    fun movingFramesResetTheWindow() {
        val s = PredictionStabilizer()
        s.hand("A", 7)
        assertEquals(emptyList<StabilizerEvent>(), s.hand("A", 1, moving = true))
        assertEquals(emptyList<StabilizerEvent>(), s.hand("A", 7))
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 1))
    }

    @Test
    fun sameLetterNeedsNoHandOrOtherLetterBetween() {
        val s = PredictionStabilizer()
        assertEquals(1, s.hand("A", 30).size)
        s.noHand(100)
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 8))
        assertEquals(listOf(StabilizerEvent.Letter("B")), s.hand("B", 8))
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 8))
    }

    @Test
    fun spaceOnceAfterOneSecondWithoutHand() {
        val s = PredictionStabilizer()
        s.hand("A", 8)
        val events = s.noHand(3000)
        assertEquals(listOf(StabilizerEvent.Space), events)
    }

    @Test
    fun spaceNotBeforeOneSecond() {
        val s = PredictionStabilizer()
        s.hand("A", 8)
        assertEquals(emptyList<StabilizerEvent>(), s.noHand(900))
    }

    @Test
    fun noSpaceAsFirstOutput() {
        val s = PredictionStabilizer()
        assertEquals(emptyList<StabilizerEvent>(), s.noHand(3000))
    }

    @Test
    fun noSpaceRightAfterSpace() {
        val s = PredictionStabilizer()
        s.hand("A", 8)
        assertEquals(listOf(StabilizerEvent.Space), s.noHand(1500))
        s.hand("B", 3) // hand back briefly, nothing committed
        assertEquals(emptyList<StabilizerEvent>(), s.noHand(1500))
    }

    @Test
    fun nullGuessWithHandDoesNotVote() {
        val s = PredictionStabilizer()
        assertEquals(emptyList<StabilizerEvent>(), s.hand(null, 20))
    }

    @Test
    fun syncAfterClearPreventsLeadingSpaceAndAllowsSameLetter() {
        val s = PredictionStabilizer()
        s.hand("A", 8)
        s.syncWithTranscript(emptyOrEndsWithSpace = true) // user tapped Clear
        assertEquals(listOf(StabilizerEvent.Letter("A")), s.hand("A", 8))
        s.syncWithTranscript(emptyOrEndsWithSpace = true)
        assertEquals(emptyList<StabilizerEvent>(), s.noHand(2000))
    }

    @Test
    fun windowNeedsFreshVotesAfterCommit() {
        val s = PredictionStabilizer()
        s.hand("A", 8)
        // B needs its own 8 votes; leftover A votes don't count toward it
        assertNull(s.hand("B", 7).firstOrNull())
        assertEquals(listOf(StabilizerEvent.Letter("B")), s.hand("B", 1))
    }
}
