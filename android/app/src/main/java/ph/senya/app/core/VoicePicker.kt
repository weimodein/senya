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
}
