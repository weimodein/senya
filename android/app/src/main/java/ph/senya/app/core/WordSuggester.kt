package ph.senya.app.core

import java.util.Locale

/** Suggestion chips (M2 mockup): the word being spelled, then completions from a list ordered most common first. No Android imports. */
class WordSuggester(lines: List<String>) {
    private val words = lines.map { it.trim().uppercase(Locale.ROOT) }
        .filter { it.isNotEmpty() && !it.startsWith("#") }
        .distinct()

    /** Suggestions for the letters after the last space in [text]; empty when no word is being spelled. */
    fun suggest(text: String, max: Int = 3): List<String> {
        val prefix = text.substringAfterLast(' ').uppercase(Locale.ROOT)
        if (prefix.isEmpty() || max <= 0) return emptyList()
        return (listOf(prefix) + words.filter { it.startsWith(prefix) && it != prefix }).take(max)
    }
}
