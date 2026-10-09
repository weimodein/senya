package ph.senya.app.ml

import ph.senya.app.core.NONE_LABEL

/** What Settings and the update screen say about a model, read from its label files without loading it. */
data class ModelInfo(val version: Int, val staticLabels: List<String>, val motionLabels: List<String>) {
    val hasMotion: Boolean get() = motionLabels.isNotEmpty()

    /** "Static letters + J/Z", or "Static letters only" for a version without usable motion letters. */
    val typeText: String
        get() = if (hasMotion) "Static letters + ${motionLabels.joinToString("/")}" else "Static letters only"

    companion object {
        fun of(bundle: ModelBundle) = ModelInfo(
            bundle.version,
            bundle.static.labels,
            bundle.motion?.labels.orEmpty().filter { it != NONE_LABEL },
        )

        /** Null when [source] has no readable labels.json. */
        fun read(version: Int, source: ModelSource): ModelInfo? {
            val static = labels(source, ModelFiles.LABELS) ?: return null
            val motion = if (source.read(ModelFiles.MOTION_MODEL) == null) emptyList()
                         else labels(source, ModelFiles.MOTION_LABELS).orEmpty()
            return ModelInfo(version, static, motion.filter { it != NONE_LABEL })
        }

        private fun labels(source: ModelSource, file: String): List<String>? =
            source.read(file)?.let { bytes -> runCatching { ModelJson.parseLabels(bytes, file) }.getOrNull() }
    }
}
