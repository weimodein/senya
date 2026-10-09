package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class VoicePickerTest {
    private fun v(name: String, lang: String, country: String, net: Boolean = false, installed: Boolean = true) =
        VoicePicker.Option(name, lang, country, net, installed)

    @Test
    fun prefersFilipinoPhilippines() {
        val pick = VoicePicker.pick(listOf(v("en-us", "en", "US"), v("fil", "fil", "PH"), v("tl", "tl", "")))
        assertEquals("fil", pick!!.name)
    }

    @Test
    fun acceptsLegacyTagalogCode() {
        assertEquals("tl", VoicePicker.pick(listOf(v("en-us", "en", "US"), v("tl", "tl", "PH")))!!.name)
    }

    @Test
    fun skipsNetworkAndNotInstalledVoices() {
        val pick = VoicePicker.pick(listOf(
            v("fil-net", "fil", "PH", net = true),
            v("fil-missing", "fil", "PH", installed = false),
            v("en-ph", "en", "PH"),
        ))
        assertEquals("en-ph", pick!!.name)
    }

    @Test
    fun englishPhilippinesBeforeOtherEnglish() {
        assertEquals("en-ph", VoicePicker.pick(listOf(v("en-us", "en", "US"), v("en-ph", "en", "PH")))!!.name)
    }

    @Test
    fun nullWhenNothingUsable() {
        assertNull(VoicePicker.pick(listOf(v("ja", "ja", "JP"), v("en-net", "en", "US", net = true))))
    }
}
