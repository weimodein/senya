package ph.senya.app.core

/** The committed text as tokens, so Backspace removes a whole label such as "NG". */
class Transcript {
    private val tokens = mutableListOf<String>()

    val text: String get() = tokens.joinToString("")
    val isEmpty: Boolean get() = tokens.isEmpty()
    val endsWithSpace: Boolean get() = tokens.lastOrNull() == " "

    fun apply(event: StabilizerEvent) {
        when (event) {
            is StabilizerEvent.Letter -> tokens += event.label
            is StabilizerEvent.Space -> tokens += " "
            is StabilizerEvent.ReplaceLast -> {
                if (tokens.isNotEmpty()) tokens.removeAt(tokens.lastIndex)
                tokens += event.label
            }
        }
    }

    fun backspace() {
        if (tokens.isNotEmpty()) tokens.removeAt(tokens.lastIndex)
    }

    fun clear() = tokens.clear()

    /** Replaces the word being spelled with [word] and ends it with a space (tapping a suggestion chip). */
    fun completeWord(word: String) {
        while (tokens.isNotEmpty() && tokens.last() != " ") tokens.removeAt(tokens.lastIndex)
        word.forEach { tokens += it.toString() }
        tokens += " "
    }

    /** The last finished word, for speaking a word when its space is committed. */
    fun lastWord(): String = text.trimEnd().substringAfterLast(' ')
}
