package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Test

class WordSuggesterTest {
    private val s = WordSuggester(listOf(
        "# comment", "", "MAGANDA", "magandang umaga", "AKO", "JAZZ", "JAZZY", "JAZZ BAND", "MAGANDA",
    ))

    @Test
    fun partialWordFirstThenCompletionsInListOrder() {
        assertEquals(listOf("MAG", "MAGANDA", "MAGANDANG UMAGA"), s.suggest("MAG"))
    }

    @Test
    fun exactWordIsNotRepeated() {
        assertEquals(listOf("JAZZ", "JAZZY", "JAZZ BAND"), s.suggest("JAZZ"))
    }

    @Test
    fun onlyTheLastWordCounts() {
        assertEquals(listOf("A", "AKO"), s.suggest("MAGANDA A"))
    }

    @Test
    fun lowercaseInputIsUppercased() {
        assertEquals(listOf("AK", "AKO"), s.suggest("ak"))
    }

    @Test
    fun noSuggestionsWithoutPartialWord() {
        assertEquals(emptyList<String>(), s.suggest(""))
        assertEquals(emptyList<String>(), s.suggest("AKO "))
    }

    @Test
    fun unknownWordStillOffersItself() {
        assertEquals(listOf("XQ"), s.suggest("XQ"))
    }

    @Test
    fun respectsMax() {
        assertEquals(listOf("MAG", "MAGANDA"), s.suggest("MAG", max = 2))
    }
}
