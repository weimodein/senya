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
}
