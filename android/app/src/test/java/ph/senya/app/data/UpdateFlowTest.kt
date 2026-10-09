package ph.senya.app.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import ph.senya.app.data.ModelUpdater.Part
import ph.senya.app.data.ModelUpdater.Result
import ph.senya.app.data.ModelUpdater.Step
import ph.senya.app.ml.DirModelSource
import ph.senya.app.ml.ModelBundle
import ph.senya.app.ml.ModelInfo
import ph.senya.app.ml.ProbabilityModel
import ph.senya.app.testutil.FakeModel
import ph.senya.app.testutil.TestModels

class UpdateFlowTest {
    @get:Rule val tmp = TemporaryFolder()
    private val made = mutableListOf<FakeModel>()
    private val factory: (ByteArray) -> ProbabilityModel = { bytes -> (TestModels.factory(bytes) as FakeModel).also { made += it } }
    private val v3 = ModelInfo(3, listOf("A", "B"), listOf("J", "Z"))
    private val states = mutableListOf<UpdateScreenState>()

    private fun bundle(v: Int, withMotion: Boolean = true) =
        ModelBundle.load(v, DirModelSource(TestModels.writeFolder(tmp.newFolder("v$v"), withMotion = withMotion)), factory)

    private fun flow(current: ModelInfo? = v3, check: (Boolean, (Step) -> Unit, () -> Boolean) -> Result) =
        UpdateFlow(check, { current }, { states += it })

    @Test
    fun stepsThenUpdated() {
        val b4 = bundle(4)
        flow { _, onStep, _ ->
            onStep(Step.Checking)
            onStep(Step.Downloading(4, 0.72f, 0.38f))
            onStep(Step.Verifying(4, Part.OK, Part.CHECKING))
            Result.Updated(b4)
        }.run()
        val v4 = ModelInfo(4, listOf("A", "B"), listOf("J", "Z"))
        assertEquals(listOf(
            UpdateScreenState.Checking(v3),
            UpdateScreenState.Downloading(v3, 4, 72, 38),
            UpdateScreenState.Verifying(v3, 4, Part.OK, Part.CHECKING),
            UpdateScreenState.Updated(v4, 3, 4),
        ), states)
    }

    @Test
    fun updatedClosesBundleAndReportsVersions() {
        val b4 = bundle(4)
        flow { _, _, _ -> Result.Updated(b4) }.run()
        assertTrue(made.isNotEmpty())
        assertTrue(made.all { it.closed })
    }

    @Test
    fun olderVersionIsRolledBack() {
        val b2 = bundle(2)
        flow { _, _, _ -> Result.Updated(b2) }.run()
        assertEquals(UpdateScreenState.RolledBack(ModelInfo(2, listOf("A", "B"), listOf("J", "Z")), 3, 2), states.last())
    }

    @Test
    fun motionErrorIsStaticOnly() {
        val b4 = bundle(4, withMotion = false)
        flow { _, _, _ -> Result.Updated(b4, "checksum mismatch for motion.tflite") }.run()
        assertEquals(UpdateScreenState.StaticOnly(ModelInfo(4, listOf("A", "B"), emptyList()), "checksum mismatch for motion.tflite"),
            states.last())
    }

    @Test
    fun failureKeepsCurrent() {
        flow { _, _, _ -> Result.Failed("can't reach server (timeout)") }.run()
        assertEquals(UpdateScreenState.Failed(v3, "can't reach server (timeout)"), states.last())
    }

    @Test
    fun upToDateAndNoModel() {
        flow { _, _, _ -> Result.UpToDate }.run()
        assertEquals(UpdateScreenState.UpToDate(v3), states.last())
        flow(current = null) { _, _, _ -> Result.NoModelPublished }.run()
        assertEquals(UpdateScreenState.NoModelPublished(null), states.last())
    }

    @Test
    fun cancelStopsStepsAndShowsCancelled() {
        lateinit var f: UpdateFlow
        f = flow { _, onStep, isCancelled ->
            onStep(Step.Checking)
            f.cancel()
            onStep(Step.Downloading(4, 0.5f, null))
            assertTrue(isCancelled())
            Result.Cancelled
        }
        f.run()
        assertFalse(states.any { it is UpdateScreenState.Downloading })
        assertEquals(UpdateScreenState.Cancelled(v3), states.last())
    }

    @Test
    fun forceIsPassedThroughAndRunResetsCancel() {
        var forced: Boolean? = null
        var cancelledAtStart: Boolean? = null
        val f = flow { force, _, isCancelled -> forced = force; cancelledAtStart = isCancelled(); Result.UpToDate }
        f.cancel()
        f.run(force = true)
        assertEquals(true, forced)
        assertEquals(false, cancelledAtStart)
    }
}
