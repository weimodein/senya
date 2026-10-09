package ph.senya.app.ml

import android.content.res.AssetManager
import java.io.File
import java.io.IOException

/** File names inside a model folder (contract §3 items 3–10). */
object ModelFiles {
    const val MODEL = "model.tflite"
    const val LABELS = "labels.json"
    const val GOLDEN = "golden.json"
    const val MOTION_MODEL = "motion.tflite"
    const val MOTION_LABELS = "motion_labels.json"
    const val MOTION_CONFIG = "motion_config.json"
    const val MOTION_GOLDEN = "motion_golden.json"
}

interface ModelSource {
    /** The file's bytes, or null if it doesn't exist. */
    fun read(name: String): ByteArray?
}

class DirModelSource(private val dir: File) : ModelSource {
    override fun read(name: String): ByteArray? = File(dir, name).takeIf { it.isFile }?.readBytes()
}

class AssetModelSource(private val assets: AssetManager, private val folder: String = "model") : ModelSource {
    override fun read(name: String): ByteArray? = try {
        assets.open("$folder/$name").use { it.readBytes() }
    } catch (e: IOException) {
        null
    }
}
