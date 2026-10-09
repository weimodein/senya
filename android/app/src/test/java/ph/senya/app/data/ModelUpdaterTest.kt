package ph.senya.app.data

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import ph.senya.app.ml.ModelFiles
import ph.senya.app.testutil.FakeModel
import ph.senya.app.testutil.TestModels
import ph.senya.app.testutil.TestServer
import java.io.File

class ModelUpdaterTest {
    @get:Rule val tmp = TemporaryFolder()
    private lateinit var root: File
    private lateinit var modelsDir: File
    private lateinit var server: TestServer
    private lateinit var updater: ModelUpdater

    @Before
    fun setUp() {
        root = tmp.newFolder("server")
        modelsDir = tmp.newFolder("models")
        server = TestServer(root)
        updater = ModelUpdater(modelsDir, TestModels.factory)
    }

    @After
    fun tearDown() = server.close()

    /** Publishes version [v] like the platform does (contract §3 item 9). */
    private fun publish(
        v: Int,
        withMotion: Boolean = true,
        sha: String? = null,
        golden: String = TestModels.staticGolden(),
        motionGolden: String = TestModels.motionGolden(),
        motionSha: String? = null,
    ) {
        val dir = TestModels.writeFolder(File(root, "models/v$v"), withMotion = withMotion, golden = golden, motionGolden = motionGolden)
        val modelSha = sha ?: sha256Hex(File(dir, ModelFiles.MODEL).readBytes())
        val motion = if (!withMotion) "null" else """{"model_url": "/models/v$v/motion.tflite",
            "labels_url": "/models/v$v/motion_labels.json", "config_url": "/models/v$v/motion_config.json",
            "sha256": "${motionSha ?: sha256Hex(File(dir, ModelFiles.MOTION_MODEL).readBytes())}"}"""
        File(root, "api/model").mkdirs()
        File(root, "api/model/latest").writeText("""{"version": $v, "model_url": "/models/v$v/model.tflite",
            "labels_url": "/models/v$v/labels.json", "sha256": "$modelSha", "motion": $motion}""")
    }

    private fun leftovers() = modelsDir.listFiles().orEmpty().filter { it.name.startsWith("tmp-v") }

    @Test
    fun installsNewVersion() {
        publish(3)
        val result = updater.check(server.baseUrl, localVersion = 0)
        assertTrue(result is ModelUpdater.Result.Updated)
        val bundle = (result as ModelUpdater.Result.Updated).bundle
        assertEquals(3, bundle.version)
        assertNotNull(bundle.motion)
        assertTrue(File(updater.installedDir(3), ModelFiles.MOTION_GOLDEN).isFile)
        assertTrue(leftovers().isEmpty())
    }

    @Test
    fun staticOnlyVersion() {
        publish(4, withMotion = false)
        val result = updater.check(server.baseUrl + "/", 0) as ModelUpdater.Result.Updated
        assertNull(result.bundle.motion)
        assertNull(result.motionError)
    }

    @Test
    fun upToDate() {
        publish(3)
        assertEquals(ModelUpdater.Result.UpToDate, updater.check(server.baseUrl, localVersion = 3))
    }

    @Test
    fun rollbackToOlderVersion() {
        publish(2)
        val result = updater.check(server.baseUrl, localVersion = 3)
        assertEquals(2, (result as ModelUpdater.Result.Updated).bundle.version)
    }

    @Test
    fun noModelPublished() {
        assertEquals(ModelUpdater.Result.NoModelPublished, updater.check(server.baseUrl, 0))
    }

    @Test
    fun checksumMismatchKeepsNothing() {
        publish(3, sha = "0".repeat(64))
        val result = updater.check(server.baseUrl, 0)
        assertTrue(result is ModelUpdater.Result.Failed)
        assertTrue((result as ModelUpdater.Result.Failed).message.contains("checksum"))
        assertFalse(updater.installedDir(3).exists())
        assertTrue(leftovers().isEmpty())
    }

    @Test
    fun rejectsVersionThatFailsGolden() {
        publish(3, golden = TestModels.staticGolden(listOf(0.9f to "A")))
        val result = updater.check(server.baseUrl, 0)
        assertTrue((result as ModelUpdater.Result.Failed).message.contains("golden"))
        assertFalse(updater.installedDir(3).exists())
    }

    @Test
    fun missingFileFails() {
        publish(3)
        File(root, "models/v3/labels.json").delete()
        assertTrue(updater.check(server.baseUrl, 0) is ModelUpdater.Result.Failed)
        assertTrue(leftovers().isEmpty())
    }

    @Test
    fun unreachableServerFails() {
        server.close()
        assertTrue(updater.check(server.baseUrl, 0) is ModelUpdater.Result.Failed)
    }

    @Test
    fun badUrlFails() {
        assertTrue(updater.check("not a url", 0) is ModelUpdater.Result.Failed)
    }

    @Test
    fun modelThatThrowsOnGoldenFailsInsteadOfCrashing() {
        publish(3)
        val crashing = ModelUpdater(modelsDir, { FakeModel(intArrayOf(1, 63), 2) { throw IllegalStateException("bad shape") } })
        val result = crashing.check(server.baseUrl, 0)
        assertTrue(result is ModelUpdater.Result.Failed)
        assertFalse(updater.installedDir(3).exists())
        assertTrue(leftovers().isEmpty())
    }

    @Test
    fun nonHttpUrlFailsInsteadOfCrashing() {
        assertTrue(updater.check("file:///etc/hosts", 0) is ModelUpdater.Result.Failed)
        assertTrue(updater.check("ftp://example.com", 0) is ModelUpdater.Result.Failed)
    }

    /** Rotating the phone starts a second check while the first may still be downloading (same models folder). */
    @Test
    fun concurrentChecksAreSerialized() {
        publish(3)
        val firstStarted = java.util.concurrent.CountDownLatch(1)
        val releaseFirst = java.util.concurrent.CountDownLatch(1)
        val secondFetches = java.util.concurrent.atomic.AtomicInteger(0)
        val first = ModelUpdater(modelsDir, TestModels.factory) { url, onBytes ->
            if (url.path.endsWith("model.tflite")) { firstStarted.countDown(); releaseFirst.await() }
            ph.senya.app.data.httpGet(url, onBytes)
        }
        val second = ModelUpdater(modelsDir, TestModels.factory) { url, onBytes ->
            secondFetches.incrementAndGet()
            ph.senya.app.data.httpGet(url, onBytes)
        }
        val results = java.util.concurrent.ConcurrentLinkedQueue<ModelUpdater.Result>()
        val t1 = Thread { results += first.check(server.baseUrl, 0) }.also { it.start() }
        assertTrue(firstStarted.await(5, java.util.concurrent.TimeUnit.SECONDS))
        val t2 = Thread { results += second.check(server.baseUrl, 0) }.also { it.start() }
        Thread.sleep(400)
        assertEquals("second check must wait for the first", 0, secondFetches.get())
        releaseFirst.countDown()
        t1.join(5000); t2.join(5000)
        assertEquals(2, results.size)
        assertTrue(results.all { it is ModelUpdater.Result.Updated })
        assertTrue(File(updater.installedDir(3), ModelFiles.MODEL).isFile)
    }

    /** Render's free tier takes ~50 s to wake; the old 10 s read timeout failed the first check after idle. */
    @Test
    fun waitsForSlowServer() {
        publish(3)
        server.nextResponseDelayMs = 11_000
        assertTrue(updater.check(server.baseUrl, 0) is ModelUpdater.Result.Updated)
    }

    @Test
    fun badJsonFails() {
        File(root, "api/model").mkdirs()
        File(root, "api/model/latest").writeText("<html>")
        assertTrue(updater.check(server.baseUrl, 0) is ModelUpdater.Result.Failed)
    }

    @Test
    fun httpGetReportsProgress() {
        File(root, "big.bin").writeBytes(ByteArray(100_000) { it.toByte() })
        val seen = mutableListOf<Pair<Long, Long>>()
        val bytes = httpGet(java.net.URL(server.baseUrl + "/big.bin")) { read, total -> seen += read to total }
        assertEquals(100_000, bytes.size)
        assertEquals(100_000L to 100_000L, seen.last())
    }

    @Test
    fun reportsSteps() {
        publish(3)
        val steps = mutableListOf<ModelUpdater.Step>()
        updater.check(server.baseUrl, 0, onStep = { steps += it })
        assertEquals(ModelUpdater.Step.Checking, steps.first())
        assertTrue(steps.contains(ModelUpdater.Step.Downloading(3, 1f, 1f)))
        assertEquals(ModelUpdater.Step.Verifying(3, ModelUpdater.Part.OK, ModelUpdater.Part.OK), steps.last())
    }

    @Test
    fun motionChecksumMismatchInstallsStaticOnly() {
        publish(3, motionSha = "0".repeat(64))
        val result = updater.check(server.baseUrl, 0) as ModelUpdater.Result.Updated
        assertNull(result.bundle.motion)
        assertTrue(result.motionError!!.contains("checksum"))
        assertTrue(File(updater.installedDir(3), ModelFiles.MODEL).isFile)
        assertFalse(File(updater.installedDir(3), ModelFiles.MOTION_MODEL).exists())
    }

    @Test
    fun missingMotionFileInstallsStaticOnly() {
        publish(3)
        File(root, "models/v3/motion_labels.json").delete()
        val result = updater.check(server.baseUrl, 0) as ModelUpdater.Result.Updated
        assertNull(result.bundle.motion)
        assertTrue(result.motionError!!.contains("download failed"))
        assertFalse(File(updater.installedDir(3), ModelFiles.MOTION_MODEL).exists())
    }

    @Test
    fun motionGoldenFailureInstallsStaticOnly() {
        publish(3, motionGolden = TestModels.motionGolden(listOf(TestModels.frames(0.2f, 0.8f) to "Z")))
        val result = updater.check(server.baseUrl, 0) as ModelUpdater.Result.Updated
        assertNull(result.bundle.motion)
        assertTrue(result.motionError!!.contains("motion_golden"))
        assertFalse(File(updater.installedDir(3), ModelFiles.MOTION_MODEL).exists())
    }

    @Test
    fun forceReinstallsSameVersion() {
        publish(3)
        assertTrue(updater.check(server.baseUrl, localVersion = 3, force = true) is ModelUpdater.Result.Updated)
    }

    @Test
    fun cancelBeforeStartInstallsNothing() {
        publish(3)
        assertEquals(ModelUpdater.Result.Cancelled, updater.check(server.baseUrl, 0, isCancelled = { true }))
        assertFalse(updater.installedDir(3).exists())
    }

    @Test
    fun cancelDuringDownloadInstallsNothing() {
        publish(3)
        var cancel = false
        val result = updater.check(server.baseUrl, 0,
            onStep = { if (it is ModelUpdater.Step.Downloading && it.static > 0f) cancel = true },
            isCancelled = { cancel })
        assertEquals(ModelUpdater.Result.Cancelled, result)
        assertFalse(updater.installedDir(3).exists())
        assertTrue(leftovers().isEmpty())
    }

    @Test
    fun cancelAfterVerifyInstallsNothing() {
        publish(3)
        var cancel = false
        val result = updater.check(server.baseUrl, 0,
            onStep = { if (it == ModelUpdater.Step.Verifying(3, ModelUpdater.Part.OK, ModelUpdater.Part.OK)) cancel = true },
            isCancelled = { cancel })
        assertEquals(ModelUpdater.Result.Cancelled, result)
        assertFalse(updater.installedDir(3).exists())
        assertTrue(leftovers().isEmpty())
    }
}
