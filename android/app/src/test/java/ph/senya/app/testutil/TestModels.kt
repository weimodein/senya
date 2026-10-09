package ph.senya.app.testutil

import org.json.JSONArray
import org.json.JSONObject
import ph.senya.app.core.Hand
import ph.senya.app.ml.ModelFiles
import ph.senya.app.ml.ProbabilityModel
import java.io.File

/** A model whose output is computed by [fn]; records whether it was closed. */
class FakeModel(
    override val inputShape: IntArray,
    override val outputSize: Int,
    private val fn: (Any) -> FloatArray,
) : ProbabilityModel {
    var closed = false
    override fun predict(input: Any): FloatArray = fn(input)
    override fun close() { closed = true }
}

object TestModels {
    /** Static fake over ["A", "B"]: predicts B (0.9) when landmarks[0] > 0.5, else A (0.8). */
    fun staticAB() = FakeModel(intArrayOf(1, Hand.FLOATS), 2) { input ->
        @Suppress("UNCHECKED_CAST")
        val x = (input as Array<FloatArray>)[0][0]
        if (x > 0.5f) floatArrayOf(0.1f, 0.9f) else floatArrayOf(0.8f, 0.2f)
    }

    /** Motion fake over ["_none", "J", "Z"]: J (0.9) when x0 grows from first to last frame, else _none. */
    fun motionNoneJZ() = FakeModel(intArrayOf(1, Hand.FRAMES, Hand.FLOATS), 3) { input ->
        @Suppress("UNCHECKED_CAST")
        val frames = (input as Array<Array<FloatArray>>)[0]
        if (frames.last()[0] > frames.first()[0]) floatArrayOf(0.05f, 0.9f, 0.05f)
        else floatArrayOf(0.9f, 0.05f, 0.05f)
    }

    /** Model factory that picks a fake by the model file's text: "static" or "motion". */
    val factory: (ByteArray) -> ProbabilityModel = { bytes ->
        when (String(bytes)) {
            "static" -> staticAB()
            "motion" -> motionNoneJZ()
            else -> throw IllegalArgumentException("not a model")
        }
    }

    fun landmarks(x0: Float) = FloatArray(Hand.FLOATS).also { it[0] = x0 }

    fun frames(fromX: Float, toX: Float) =
        Array(Hand.FRAMES) { k -> FloatArray(Hand.FLOATS).also { it[0] = fromX + (toX - fromX) * k / (Hand.FRAMES - 1) } }

    fun staticGolden(samples: List<Pair<Float, String>> = listOf(0.1f to "A", 0.9f to "B")): String =
        JSONArray(samples.map { (x, label) ->
            JSONObject().put("landmarks", floats(landmarks(x))).put("label", label)
        }).toString()

    fun motionGolden(samples: List<Pair<Array<FloatArray>, String>> =
                         listOf(frames(0.2f, 0.8f) to "J", frames(0.5f, 0.5f) to "_none")): String =
        JSONArray(samples.map { (f, label) ->
            JSONObject().put("frames", JSONArray(f.map { floats(it) })).put("label", label)
        }).toString()

    const val MOTION_CONFIG = """{"T": 32, "start_speed": 1.0, "stop_speed": 0.5, "stop_hold_ms": 200,
        "pad_ms": 150, "min_ms": 300, "max_ms": 2500, "max_missing": 0.25, "min_confidence": 0.7,
        "replace_window_ms": 1000, "start_shapes": {"J": ["I"], "Z": []}}"""

    /** Writes a model folder with the contract's file names and returns it. */
    fun writeFolder(
        dir: File,
        withMotion: Boolean = true,
        labels: String = """["A","B"]""",
        golden: String = staticGolden(),
        motionLabels: String = """["_none","J","Z"]""",
        motionGolden: String = motionGolden(),
        motionConfig: String = MOTION_CONFIG,
    ): File {
        dir.mkdirs()
        File(dir, ModelFiles.MODEL).writeText("static")
        File(dir, ModelFiles.LABELS).writeText(labels)
        File(dir, ModelFiles.GOLDEN).writeText(golden)
        if (withMotion) {
            File(dir, ModelFiles.MOTION_MODEL).writeText("motion")
            File(dir, ModelFiles.MOTION_LABELS).writeText(motionLabels)
            File(dir, ModelFiles.MOTION_GOLDEN).writeText(motionGolden)
            File(dir, ModelFiles.MOTION_CONFIG).writeText(motionConfig)
        }
        return dir
    }

    private fun floats(values: FloatArray) = JSONArray(values.map { it.toDouble() })
}
