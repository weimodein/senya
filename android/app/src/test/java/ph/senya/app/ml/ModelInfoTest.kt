package ph.senya.app.ml

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import ph.senya.app.testutil.TestModels
import java.io.File

class ModelInfoTest {
    @get:Rule val tmp = TemporaryFolder()

    @Test
    fun readsLabelsWithoutNone() {
        val info = ModelInfo.read(3, DirModelSource(TestModels.writeFolder(tmp.newFolder("v3"))))!!
        assertEquals(ModelInfo(3, listOf("A", "B"), listOf("J", "Z")), info)
        assertEquals("Static letters + J/Z", info.typeText)
    }

    @Test
    fun staticOnlyFolder() {
        val info = ModelInfo.read(4, DirModelSource(TestModels.writeFolder(tmp.newFolder("v4"), withMotion = false)))!!
        assertFalse(info.hasMotion)
        assertEquals("Static letters only", info.typeText)
    }

    @Test
    fun nullWithoutLabels() {
        val dir = TestModels.writeFolder(tmp.newFolder("v5"))
        File(dir, ModelFiles.LABELS).delete()
        assertNull(ModelInfo.read(5, DirModelSource(dir)))
    }

    @Test
    fun ofBundle() {
        val bundle = ModelBundle.load(6, DirModelSource(TestModels.writeFolder(tmp.newFolder("v6"))), TestModels.factory)
        assertEquals(ModelInfo(6, listOf("A", "B"), listOf("J", "Z")), bundle.use { ModelInfo.of(it) })
    }
}
