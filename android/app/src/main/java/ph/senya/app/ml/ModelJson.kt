package ph.senya.app.ml

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import ph.senya.app.core.MotionConfig

class ModelLoadException(message: String, cause: Throwable? = null) : Exception(message, cause)

object ModelJson {
    fun parseLabels(bytes: ByteArray, file: String): List<String> = parse(file, bytes) { text ->
        val a = JSONArray(text)
        List(a.length()) { a.getString(it) }
    }

    fun parseStaticGolden(bytes: ByteArray): List<Pair<FloatArray, String>> = parse(ModelFiles.GOLDEN, bytes) { text ->
        val a = JSONArray(text)
        List(a.length()) { i ->
            val o = a.getJSONObject(i)
            floats(o.getJSONArray("landmarks")) to o.getString("label")
        }
    }

    fun parseMotionGolden(bytes: ByteArray): List<Pair<Array<FloatArray>, String>> = parse(ModelFiles.MOTION_GOLDEN, bytes) { text ->
        val a = JSONArray(text)
        List(a.length()) { i ->
            val o = a.getJSONObject(i)
            val frames = o.getJSONArray("frames")
            Array(frames.length()) { floats(frames.getJSONArray(it)) } to o.getString("label")
        }
    }

    fun parseMotionConfig(bytes: ByteArray): MotionConfig = parse(ModelFiles.MOTION_CONFIG, bytes) { text ->
        val o = JSONObject(text)
        val d = MotionConfig()
        MotionConfig(
            t = o.optInt("T", d.t),
            startSpeed = o.optDouble("start_speed", d.startSpeed.toDouble()).toFloat(),
            stopSpeed = o.optDouble("stop_speed", d.stopSpeed.toDouble()).toFloat(),
            stopHoldMs = o.optLong("stop_hold_ms", d.stopHoldMs),
            padMs = o.optLong("pad_ms", d.padMs),
            minMs = o.optLong("min_ms", d.minMs),
            maxMs = o.optLong("max_ms", d.maxMs),
            maxMissing = o.optDouble("max_missing", d.maxMissing.toDouble()).toFloat(),
            minConfidence = o.optDouble("min_confidence", d.minConfidence.toDouble()).toFloat(),
            replaceWindowMs = o.optLong("replace_window_ms", d.replaceWindowMs),
            startShapes = o.optJSONObject("start_shapes")?.let { shapes ->
                shapes.keys().asSequence().associateWith { key ->
                    val arr = shapes.getJSONArray(key)
                    List(arr.length()) { arr.getString(it) }
                }
            } ?: d.startShapes,
        )
    }

    private fun floats(a: JSONArray) = FloatArray(a.length()) { a.getDouble(it).toFloat() }

    private inline fun <T> parse(file: String, bytes: ByteArray, block: (String) -> T): T = try {
        block(String(bytes, Charsets.UTF_8))
    } catch (e: JSONException) {
        throw ModelLoadException("bad $file: ${e.message}", e)
    }
}
