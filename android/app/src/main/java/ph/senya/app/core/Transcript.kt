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

    /** The last finished word, for speaking a word when its space is committed. */
    fun lastWord(): String = text.trimEnd().substringAfterLast(' ')
}
