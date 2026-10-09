package ph.senya.app.data

import org.json.JSONException
import ph.senya.app.ml.DirModelSource
import ph.senya.app.ml.ModelBundle
import ph.senya.app.ml.ModelFiles
import ph.senya.app.ml.ModelLoadException
import ph.senya.app.ml.ProbabilityModel
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.URL
import java.security.MessageDigest

class HttpStatusException(val code: Int) : IOException("HTTP $code")

fun httpGet(url: URL): ByteArray {
    val conn = url.openConnection() as HttpURLConnection
    conn.connectTimeout = 3000
    // Render's free tier accepts the connection at once but can take ~50 s to answer while it wakes up
    conn.readTimeout = 60000
    try {
        val code = conn.responseCode
        if (code != 200) throw HttpStatusException(code)
        return conn.inputStream.use { it.readBytes() }
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
    private val fetch: (URL) -> ByteArray = ::httpGet,
) {
    sealed class Result {
        data class Updated(val bundle: ModelBundle) : Result()
        object UpToDate : Result()
        object NoModelPublished : Result()
        data class Failed(val message: String) : Result()
    }

    fun installedDir(version: Int) = File(modelsDir, "v$version")

    /**
     * One check at a time per process: rotating the phone starts a second check while the first may still be
     * downloading into the same folder. Never throws; every failure is a [Result.Failed].
     */
    fun check(baseUrl: String, localVersion: Int): Result = synchronized(LOCK) {
        try {
            checkLocked(baseUrl, localVersion)
        } catch (e: RuntimeException) {
            Result.Failed("unexpected error (${e.message})")
        }
    }

    private fun checkLocked(baseUrl: String, localVersion: Int): Result {
        val base = try {
            URL(baseUrl.trim().trimEnd('/') + "/")
        } catch (e: MalformedURLException) {
            return Result.Failed("bad server URL: $baseUrl")
        }
        if (base.protocol != "http" && base.protocol != "https") return Result.Failed("bad server URL: $baseUrl")
        val latest = try {
            LatestModel.parse(String(fetch(URL(base, "api/model/latest")), Charsets.UTF_8))
        } catch (e: HttpStatusException) {
            return if (e.code == 404) Result.NoModelPublished else Result.Failed("server error ${e.code}")
        } catch (e: IOException) {
            return Result.Failed("can't reach server (${e.message})")
        } catch (e: JSONException) {
            return Result.Failed("bad response from server")
        }
        if (latest.version == localVersion) return Result.UpToDate

        val tmp = File(modelsDir, "tmp-v${latest.version}")
        try {
            tmp.deleteRecursively()
            if (!tmp.mkdirs()) return Result.Failed("can't write ${tmp.path}")
            for ((name, path) in filesFor(latest)) File(tmp, name).writeBytes(fetch(URL(base, path)))
            checkSha(tmp, ModelFiles.MODEL, latest.sha256)?.let { return Result.Failed(it) }
            latest.motion?.let { m -> checkSha(tmp, ModelFiles.MOTION_MODEL, m.sha256)?.let { return Result.Failed(it) } }
            val bundle = try {
                ModelBundle.load(latest.version, DirModelSource(tmp), modelFactory)
            } catch (e: ModelLoadException) {
                return Result.Failed("model v${latest.version} rejected: ${e.message}")
            }
            val dest = installedDir(latest.version)
            dest.deleteRecursively()
            if (!tmp.renameTo(dest)) {
                bundle.close()
                return Result.Failed("can't install model v${latest.version}")
            }
            return Result.Updated(bundle)
        } catch (e: IOException) {
            return Result.Failed("download failed (${e.message})")
        } finally {
            tmp.deleteRecursively()
        }
    }

    private fun filesFor(latest: LatestModel): List<Pair<String, String>> {
        val files = mutableListOf(
            ModelFiles.MODEL to latest.modelUrl,
            ModelFiles.LABELS to latest.labelsUrl,
            ModelFiles.GOLDEN to sibling(latest.modelUrl, ModelFiles.GOLDEN),
        )
        latest.motion?.let { m ->
            files += ModelFiles.MOTION_MODEL to m.modelUrl
            files += ModelFiles.MOTION_LABELS to m.labelsUrl
            files += ModelFiles.MOTION_CONFIG to m.configUrl
            files += ModelFiles.MOTION_GOLDEN to sibling(m.modelUrl, ModelFiles.MOTION_GOLDEN)
        }
        return files
    }

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
