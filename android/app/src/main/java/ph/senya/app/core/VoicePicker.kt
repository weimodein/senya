package ph.senya.app.core

/** Spec §5.2: prefer fil-PH, fall back to English; offline, installed voices only. */
object VoicePicker {
    data class Option(
        val name: String,
        val language: String,
        val country: String,
        val needsNetwork: Boolean,
        val installed: Boolean,
    )

    private val FILIPINO = setOf("fil", "tl")

    fun pick(options: List<Option>): Option? = options
        .filter { !it.needsNetwork && it.installed }
        .mapNotNull { option -> rank(option)?.let { option to it } }
        .minByOrNull { it.second }
        ?.first

    private fun rank(o: Option): Int? = when {
        o.language in FILIPINO && o.country == "PH" -> 0
        o.language in FILIPINO -> 1
        o.language == "en" && o.country == "PH" -> 2
        o.language == "en" -> 3
        else -> null
    }

    /** "Filipino · Voice 1", "Filipino · Voice 2": engine voice names mean nothing to people. */
    fun labels(languages: List<String>): List<String> {
        val counts = mutableMapOf<String, Int>()
        return languages.map { language ->
            val n = (counts[language] ?: 0) + 1
            counts[language] = n
            "$language · Voice $n"
        }
    }
}
