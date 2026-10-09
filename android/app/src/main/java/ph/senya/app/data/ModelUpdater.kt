package ph.senya.app.data

import org.json.JSONException
import ph.senya.app.ml.DirModelSource
import ph.senya.app.ml.ModelBundle
import ph.senya.app.ml.ModelFiles
import ph.senya.app.ml.ModelLoadException
import ph.senya.app.ml.ProbabilityModel
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.URL
import java.security.MessageDigest

class HttpStatusException(val code: Int) : IOException("HTTP $code")

/** Thrown from inside a download when the user cancels; never escapes [ModelUpdater.check]. */
class CancelledException : IOException("cancelled")

/** [onBytes] gets (bytes read so far, Content-Length or -1) after every chunk, and may throw to stop the download. */
fun httpGet(url: URL, onBytes: (read: Long, total: Long) -> Unit = { _, _ -> }): ByteArray {
    val conn = url.openConnection() as HttpURLConnection
    conn.connectTimeout = 3000
    // Render's free tier accepts the connection at once but can take ~50 s to answer while it wakes up
    conn.readTimeout = 60000
    try {
        val code = conn.responseCode
        if (code != 200) throw HttpStatusException(code)
        val total = conn.contentLengthLong
        val out = ByteArrayOutputStream(if (total in 1..Int.MAX_VALUE) total.toInt() else 8192)
        conn.inputStream.use { input ->
            val buffer = ByteArray(16 * 1024)
            var read = 0L
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                out.write(buffer, 0, n)
                read += n
                onBytes(read, total)
            }
        }
        return out.toByteArray()
    } finally {
        conn.disconnect()
    }
}

fun sha256Hex(bytes: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }

/** Downloads, verifies, and installs a published model version (spec §5.2 ModelRepository). No Android imports. */
class ModelUpdater(
    private val modelsDir: File,
    private val modelFactory: (ByteArray) -> ProbabilityModel,
    private val fetch: (URL, (Long, Long) -> Unit) -> ByteArray = ::httpGet,
) {
    enum class Part { PENDING, CHECKING, OK, FAILED }

    /** Progress for the model update screen (M3 mockup), reported on the checking thread. */
    sealed class Step {
        object Checking : Step() {
            override fun toString() = "Checking"
        }
        /** Fractions from 0 to 1; [motion] is null when the version has no motion model. */
        data class Downloading(val version: Int, val static: Float, val motion: Float?) : Step()
        data class Verifying(val version: Int, val static: Part, val motion: Part?) : Step()
    }

    sealed class Result {
        /** [motionError] is set when the version's motion model couldn't be used: only the static model was installed. */
        data class Updated(val bundle: ModelBundle, val motionError: String? = null) : Result()
        object UpToDate : Result()
        object NoModelPublished : Result()
        object Cancelled : Result()
        data class Failed(val message: String) : Result()
    }

    fun installedDir(version: Int) = File(modelsDir, "v$version")

    /**
     * One check at a time per process: rotating the phone starts a second check while the first may still be
     * downloading into the same folder. Never throws; every failure is a [Result.Failed].
     * [force] downloads the published version even when it's the installed one ("Retry motion model").
     * [isCancelled] is polled between files and chunks; once it returns true, nothing is installed.
     */
    fun check(
        baseUrl: String,
        localVersion: Int,
        force: Boolean = false,
        onStep: (Step) -> Unit = {},
        isCancelled: () -> Boolean = { false },
    ): Result = synchronized(LOCK) {
        try {
            checkLocked(baseUrl, localVersion, force, onStep, isCancelled)
        } catch (e: RuntimeException) {
            Result.Failed("unexpected error (${e.message})")
        }
    }

    private fun checkLocked(
        baseUrl: String,
        localVersion: Int,
        force: Boolean,
        onStep: (Step) -> Unit,
        isCancelled: () -> Boolean,
    ): Result {
        val base = try {
            URL(baseUrl.trim().trimEnd('/') + "/")
        } catch (e: MalformedURLException) {
            return Result.Failed("bad server URL: $baseUrl")
        }
        if (base.protocol != "http" && base.protocol != "https") return Result.Failed("bad server URL: $baseUrl")
        if (isCancelled()) return Result.Cancelled
        onStep(Step.Checking)
        val latest = try {
            LatestModel.parse(String(fetch(URL(base, "api/model/latest")) { _, _ -> stopIf(isCancelled) }, Charsets.UTF_8))
        } catch (e: CancelledException) {
            return Result.Cancelled
        } catch (e: HttpStatusException) {
            return if (e.code == 404) Result.NoModelPublished else Result.Failed("server error ${e.code}")
        } catch (e: IOException) {
            return Result.Failed("can't reach server (${e.message})")
        } catch (e: JSONException) {
            return Result.Failed("bad response from server")
        }
        if (isCancelled()) return Result.Cancelled
        if (latest.version == localVersion && !force) return Result.UpToDate

        val v = latest.version
        val tmp = File(modelsDir, "tmp-v$v")
        try {
            tmp.deleteRecursively()
            if (!tmp.mkdirs()) return Result.Failed("can't write ${tmp.path}")
            var staticDone = 0f
            var motionDone: Float? = if (latest.motion != null) 0f else null
            onStep(Step.Downloading(v, staticDone, motionDone))
            download(base, tmp, staticFiles(latest), isCancelled) {
                staticDone = it
                onStep(Step.Downloading(v, staticDone, motionDone))
            }
            var motionError: String? = null
            val motionFiles = motionFiles(latest)
            if (motionFiles.isNotEmpty()) {
                try {
                    download(base, tmp, motionFiles, isCancelled) {
                        motionDone = it
                        onStep(Step.Downloading(v, staticDone, motionDone))
                    }
                } catch (e: CancelledException) {
                    throw e
                } catch (e: IOException) {
                    motionError = "download failed (${e.message})"
                }
            }

            val motionPart = if (latest.motion == null) null else Part.PENDING
            onStep(Step.Verifying(v, Part.CHECKING, motionPart))
            checkSha(tmp, ModelFiles.MODEL, latest.sha256)?.let {
                onStep(Step.Verifying(v, Part.FAILED, motionPart))
                return Result.Failed(it)
            }
            onStep(Step.Verifying(v, Part.OK, motionPart?.let { Part.CHECKING }))
            val motion = latest.motion
            if (motion != null && motionError == null) motionError = checkSha(tmp, ModelFiles.MOTION_MODEL, motion.sha256)
            if (motionError != null) deleteMotionFiles(tmp)
            val bundle = try {
                ModelBundle.load(v, DirModelSource(tmp), modelFactory)
            } catch (e: ModelLoadException) {
                onStep(Step.Verifying(v, Part.FAILED, motionPart))
                return Result.Failed("model v$v rejected: ${e.message}")
            }
            if (motion != null && bundle.motion == null && motionError == null) {
                motionError = bundle.warning ?: "motion model unusable"
            }
            // The installed folder holds only what the bundle uses, so Settings describes it correctly
            if (bundle.motion == null) deleteMotionFiles(tmp)
            onStep(Step.Verifying(v, Part.OK, motionPart?.let { if (motionError == null) Part.OK else Part.FAILED }))
            if (isCancelled()) {
                bundle.close()
                return Result.Cancelled
            }
            val dest = installedDir(v)
            dest.deleteRecursively()
            if (!tmp.renameTo(dest)) {
                bundle.close()
                return Result.Failed("can't install model v$v")
            }
            return Result.Updated(bundle, motionError)
        } catch (e: CancelledException) {
            return Result.Cancelled
        } catch (e: IOException) {
            return Result.Failed("download failed (${e.message})")
        } finally {
            tmp.deleteRecursively()
        }
    }

    /** Fetches [files] into [dir], reporting the fraction done; each file counts equally. */
    private fun download(
        base: URL,
        dir: File,
        files: List<Pair<String, String>>,
        isCancelled: () -> Boolean,
        onFraction: (Float) -> Unit,
    ) {
        files.forEachIndexed { i, (name, path) ->
            stopIf(isCancelled)
            val bytes = fetch(URL(base, path)) { read, total ->
                stopIf(isCancelled)
                if (total > 0) onFraction((i + read.toFloat() / total) / files.size)
            }
            File(dir, name).writeBytes(bytes)
            onFraction((i + 1).toFloat() / files.size)
        }
    }

    private fun stopIf(isCancelled: () -> Boolean) {
        if (isCancelled()) throw CancelledException()
    }

    private fun staticFiles(latest: LatestModel) = listOf(
        ModelFiles.MODEL to latest.modelUrl,
        ModelFiles.LABELS to latest.labelsUrl,
        ModelFiles.GOLDEN to sibling(latest.modelUrl, ModelFiles.GOLDEN),
    )

    private fun motionFiles(latest: LatestModel): List<Pair<String, String>> = latest.motion?.let { m ->
        listOf(
            ModelFiles.MOTION_MODEL to m.modelUrl,
            ModelFiles.MOTION_LABELS to m.labelsUrl,
            ModelFiles.MOTION_CONFIG to m.configUrl,
            ModelFiles.MOTION_GOLDEN to sibling(m.modelUrl, ModelFiles.MOTION_GOLDEN),
        )
    }.orEmpty()

    private fun deleteMotionFiles(dir: File) = listOf(
        ModelFiles.MOTION_MODEL, ModelFiles.MOTION_LABELS, ModelFiles.MOTION_CONFIG, ModelFiles.MOTION_GOLDEN,
    ).forEach { File(dir, it).delete() }

    /** Golden files live next to the model (plan clarification 6). */
    private fun sibling(url: String, name: String) = url.substringBeforeLast('/') + "/" + name

    private fun checkSha(dir: File, name: String, expected: String): String? {
        val actual = sha256Hex(File(dir, name).readBytes())
        return if (actual.equals(expected, ignoreCase = true)) null else "checksum mismatch for $name"
    }

    private companion object {
        val LOCK = Any()
    }
}
