package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TranslatorEngineTest {
    private var t = 0L
    private val hand = FloatArray(Hand.FLOATS)

    private fun TranslatorEngine.frames(n: Int, landmarks: FloatArray? = hand): List<StabilizerEvent> =
        (1..n).flatMap { t += 33; onFrame(t, landmarks).events }

    private fun always(label: String) = StaticClassifier { Prediction(label, 0.9f) }

    @Test
    fun commitsStaticLetter() {
        val engine = TranslatorEngine(EngineModels(always("A")))
        assertEquals(listOf(StabilizerEvent.Letter("A")), engine.frames(8))
    }

    @Test
    fun reportsGuessAndHandAbsence() {
        val engine = TranslatorEngine(EngineModels(always("A")))
        t += 33
        assertEquals(Prediction("A", 0.9f), engine.onFrame(t, hand).staticGuess)
        t += 33
        assertNull(engine.onFrame(t, null).staticGuess)
    }

    @Test
    fun noModelMeansNoGuesses() {
        val engine = TranslatorEngine(EngineModels(static = null))
        assertEquals(emptyList<StabilizerEvent>(), engine.frames(20))
    }

    @Test
    fun swappingModelsResetsState() {
        val engine = TranslatorEngine(EngineModels(always("A")))
        engine.frames(7)
        engine.setModels(EngineModels(always("A")))
        assertEquals(emptyList<StabilizerEvent>(), engine.frames(7))
        assertEquals(listOf(StabilizerEvent.Letter("A")), engine.frames(1))
    }

    @Test
    fun transcriptEditResetsStabilizer() {
        val engine = TranslatorEngine(EngineModels(always("A")))
        engine.frames(8)
        engine.onTranscriptEdited(emptyOrEndsWithSpace = true) // Backspace removed the A
        assertEquals(listOf(StabilizerEvent.Letter("A")), engine.frames(8))
    }

    private fun line(cx: Float) = FloatArray(Hand.FLOATS).also {
        for (i in 0 until Hand.POINTS) { it[i * 3] = cx + 0.01f * i; it[i * 3 + 1] = 0.5f }
    }

    @Test
    fun motionReplacesStartShape() {
        val engine = TranslatorEngine(EngineModels(
            static = always("I"),
            motion = SequenceClassifier { Prediction("J", 0.9f) },
            config = MotionConfig(),
        ))
        val events = mutableListOf<StabilizerEvent>()
        var sawMoving = false
        for (n in 0 until 60) {
            val cx = 0.3f + 0.03f * (n.coerceIn(14, 34) - 14) // still 15 frames, moving 20, then still
            val out = engine.onFrame(33L * n, line(cx))
            sawMoving = sawMoving || out.moving
            events += out.events
        }
        assertEquals(true, sawMoving)
        assertEquals(listOf(StabilizerEvent.Letter("I"), StabilizerEvent.ReplaceLast("J")), events)
    }

    @Test
    fun staticOnlyModelsNeverReportMoving() {
        val engine = TranslatorEngine(EngineModels(always("I")))
        val moving = (0 until 60).map { n -> engine.onFrame(33L * n, line(0.3f + 0.03f * n)).moving }
        assertEquals(false, moving.any { it })
    }
}
