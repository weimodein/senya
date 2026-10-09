package ph.senya.app.ml

import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File

class BundledVersionTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun folder(version: String?): ModelSource {
        val dir = tmp.newFolder()
        if (version != null) File(dir, ModelFiles.VERSION).writeText(version)
        return DirModelSource(dir)
    }

    @Test
    fun readsTheServerVersionTheBundleWasCopiedFrom() {
        assertEquals(15, folder("15\n").bundledVersion())
    }

    @Test
    fun theDemoFixtureWithoutAVersionFileIsVersionZero() {
        assertEquals(0, folder(null).bundledVersion())
    }

    @Test
    fun anUnreadableVersionFileIsVersionZero() {
        assertEquals(0, folder("v15").bundledVersion())
        assertEquals(0, folder("-3").bundledVersion())
    }
}
