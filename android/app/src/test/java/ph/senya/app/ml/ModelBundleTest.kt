package ph.senya.app.ml

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import ph.senya.app.core.Prediction
import ph.senya.app.testutil.FakeModel
import ph.senya.app.testutil.TestModels
import java.io.File

class ModelBundleTest {
    @get:Rule val tmp = TemporaryFolder()

    private fun load(dir: File, version: Int = 1) = ModelBundle.load(version, DirModelSource(dir), TestModels.factory)

    private fun assertRejected(dir: File, messagePart: String) {
        try {
            load(dir)
            fail("expected ModelLoadException")
        } catch (e: ModelLoadException) {
            assertTrue("message was: ${e.message}", e.message!!.contains(messagePart))
        }
    }

    @Test
    fun loadsStaticAndMotion() {
        val bundle = load(TestModels.writeFolder(tmp.newFolder()), version = 3)
        assertEquals(3, bundle.version)
        assertEquals(Prediction("B", 0.9f), bundle.static.classify(TestModels.landmarks(0.9f)))
        assertEquals("J", bundle.motion!!.classify(TestModels.frames(0.1f, 0.7f)).label)
        assertEquals(listOf("I"), bundle.motionConfig.startShapes["J"])
        assertNull(bundle.warning)
    }

    @Test
    fun staticOnlyWhenNoMotionFiles() {
        val bundle = load(TestModels.writeFolder(tmp.newFolder(), withMotion = false))
        assertNull(bundle.motion)
        assertNull(bundle.warning)
    }

    @Test
    fun rejectsMissingModel() {
        val dir = TestModels.writeFolder(tmp.newFolder())
        File(dir, ModelFiles.MODEL).delete()
        assertRejected(dir, "model.tflite")
    }

    @Test
    fun rejectsLabelCountMismatch() {
        assertRejected(TestModels.writeFolder(tmp.newFolder(), labels = """["A","B","C"]"""), "labels")
    }

    @Test
    fun rejectsFailingGolden() {
        val dir = TestModels.writeFolder(tmp.newFolder(), golden = TestModels.staticGolden(listOf(0.9f to "A")))
        assertRejected(dir, "golden.json")
    }

    @Test
    fun rejectsMissingGolden() {
        val dir = TestModels.writeFolder(tmp.newFolder())
        File(dir, ModelFiles.GOLDEN).delete()
        assertRejected(dir, "golden.json")
    }

    @Test
    fun rejectsBrokenLabelsJson() {
        assertRejected(TestModels.writeFolder(tmp.newFolder(), labels = "not json"), "labels.json")
    }

    @Test
    fun brokenMotionFallsBackToStaticOnly() {
        val bundle = load(TestModels.writeFolder(tmp.newFolder(), motionLabels = """["_none","J"]"""))
        assertNull(bundle.motion)
        assertNotNull(bundle.warning)
        assertEquals(Prediction("A", 0.8f), bundle.static.classify(TestModels.landmarks(0.1f)))
    }

    @Test
    fun failingMotionGoldenFallsBackToStaticOnly() {
        val bad = TestModels.motionGolden(listOf(TestModels.frames(0.2f, 0.8f) to "Z"))
        val bundle = load(TestModels.writeFolder(tmp.newFolder(), motionGolden = bad))
        assertNull(bundle.motion)
        assertTrue(bundle.warning!!.contains("motion_golden.json"))
    }

    @Test
    fun motionConfigUsesDefaultsForMissingKeys() {
        val bundle = load(TestModels.writeFolder(tmp.newFolder(), motionConfig = """{"start_speed": 2.5}"""))
        assertEquals(2.5f, bundle.motionConfig.startSpeed, 1e-6f)
        assertEquals(200L, bundle.motionConfig.stopHoldMs)
    }

    /** TFLite throws IllegalArgumentException/IllegalStateException when a golden sample has the wrong shape. */
    private fun throwingFactory(motionToo: Boolean = true): (ByteArray) -> ProbabilityModel = { bytes ->
        when (String(bytes)) {
            "static" -> TestModels.staticAB()
            "motion" -> if (motionToo) FakeModel(intArrayOf(1, 32, 63), 3) { throw IllegalStateException("bad input shape") }
                        else TestModels.motionNoneJZ()
            else -> throw IllegalArgumentException("not a model")
        }
    }

    @Test
    fun runtimeFailureInMotionGoldenFallsBackToStaticOnly() {
        val dir = TestModels.writeFolder(tmp.newFolder())
        val bundle = ModelBundle.load(1, DirModelSource(dir), throwingFactory())
        assertNull(bundle.motion)
        assertTrue(bundle.warning!!.contains("motion_golden.json"))
    }

    @Test
    fun runtimeFailureInStaticGoldenIsRejectedNotThrown() {
        val dir = TestModels.writeFolder(tmp.newFolder())
        val factory: (ByteArray) -> ProbabilityModel = { FakeModel(intArrayOf(1, 63), 2) { throw IllegalArgumentException("bad shape") } }
        try {
            ModelBundle.load(1, DirModelSource(dir), factory)
            fail("expected ModelLoadException")
        } catch (e: ModelLoadException) {
            assertTrue(e.message!!.contains("golden.json"))
        }
    }

    @Test
    fun predictionOfPicksHighest() {
        assertEquals(Prediction("B", 0.7f), ph.senya.app.core.predictionOf(floatArrayOf(0.2f, 0.7f, 0.1f), listOf("A", "B", "C")))
    }
}
