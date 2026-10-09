package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TranscriptTest {
    @Test
    fun appliesEventsAndEdits() {
        val t = Transcript()
        assertTrue(t.isEmpty)
        t.apply(StabilizerEvent.Letter("H"))
        t.apply(StabilizerEvent.Letter("I"))
        t.apply(StabilizerEvent.ReplaceLast("J"))
        t.apply(StabilizerEvent.Space)
        assertEquals("HJ ", t.text)
        assertTrue(t.endsWithSpace)
        assertEquals("HJ", t.lastWord())
        t.backspace()
        assertEquals("HJ", t.text)
        t.clear()
        assertTrue(t.isEmpty)
        t.backspace() // no crash on empty
    }

    @Test
    fun multiCharacterLabelIsOneToken() {
        val t = Transcript()
        t.apply(StabilizerEvent.Letter("NG"))
        t.apply(StabilizerEvent.Letter("A"))
        t.backspace()
        assertEquals("NG", t.text)
        t.backspace()
        assertEquals("", t.text)
    }

    @Test
    fun lastWordAfterSeveralWords() {
        val t = Transcript()
        listOf("A", "B").forEach { t.apply(StabilizerEvent.Letter(it)) }
        t.apply(StabilizerEvent.Space)
        listOf("C", "D").forEach { t.apply(StabilizerEvent.Letter(it)) }
        t.apply(StabilizerEvent.Space)
        assertEquals("CD", t.lastWord())
    }
}
