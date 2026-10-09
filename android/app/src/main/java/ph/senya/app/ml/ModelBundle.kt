package ph.senya.app.ml

import ph.senya.app.core.Hand
import ph.senya.app.core.MotionConfig
import java.io.Closeable

/** One model version, loaded and golden-checked (contract §3 item 10). */
class ModelBundle private constructor(
    val version: Int,
    val static: SignClassifier,
    /** Null means static-only: no motion files, or they were broken (see [warning]). */
    val motion: MotionClassifier?,
    val motionConfig: MotionConfig,
    val warning: String?,
) : Closeable {

    override fun close() {
        static.close()
        motion?.close()
    }

    companion object {
        /** Throws [ModelLoadException] if the static model can't be used. A broken motion part only sets [warning]. */
        fun load(version: Int, source: ModelSource, modelFactory: (ByteArray) -> ProbabilityModel): ModelBundle {
            val static = loadStatic(source, modelFactory)
            if (source.read(ModelFiles.MOTION_MODEL) == null) {
                return ModelBundle(version, static, null, MotionConfig(), null)
            }
            return try {
                val config = ModelJson.parseMotionConfig(source.require(ModelFiles.MOTION_CONFIG))
                if (config.t != Hand.FRAMES) throw ModelLoadException("motion_config.json has T=${config.t}, expected ${Hand.FRAMES}")
                ModelBundle(version, static, loadMotion(source, modelFactory), config, null)
            } catch (e: ModelLoadException) {
                ModelBundle(version, static, null, MotionConfig(), "Motion model skipped: ${e.message}")
            }
        }

        private fun loadStatic(source: ModelSource, factory: (ByteArray) -> ProbabilityModel): SignClassifier {
            val labels = ModelJson.parseLabels(source.require(ModelFiles.LABELS), ModelFiles.LABELS)
            val classifier = build(source.require(ModelFiles.MODEL), factory) { SignClassifier(it, labels) }
            try {
                val golden = ModelJson.parseStaticGolden(source.require(ModelFiles.GOLDEN))
                checkGolden(ModelFiles.GOLDEN, golden.map { (landmarks, want) -> classifier.classify(landmarks).label to want })
            } catch (e: ModelLoadException) {
                classifier.close()
                throw e
            } catch (e: RuntimeException) {
                // TFLite throws unchecked exceptions for wrong-shaped samples or outputs
                classifier.close()
                throw ModelLoadException("${ModelFiles.GOLDEN}: ${e.message}", e)
            }
            return classifier
        }

        private fun loadMotion(source: ModelSource, factory: (ByteArray) -> ProbabilityModel): MotionClassifier {
            val labels = ModelJson.parseLabels(source.require(ModelFiles.MOTION_LABELS), ModelFiles.MOTION_LABELS)
            val classifier = build(source.require(ModelFiles.MOTION_MODEL), factory) { MotionClassifier(it, labels) }
            try {
                val golden = ModelJson.parseMotionGolden(source.require(ModelFiles.MOTION_GOLDEN))
                checkGolden(ModelFiles.MOTION_GOLDEN, golden.map { (frames, want) -> classifier.classify(frames).label to want })
            } catch (e: ModelLoadException) {
                classifier.close()
                throw e
            } catch (e: RuntimeException) {
                classifier.close()
                throw ModelLoadException("${ModelFiles.MOTION_GOLDEN}: ${e.message}", e)
            }
            return classifier
        }

        private fun ModelSource.require(name: String): ByteArray = read(name) ?: throw ModelLoadException("missing $name")

        private fun <T> build(bytes: ByteArray, factory: (ByteArray) -> ProbabilityModel, wrap: (ProbabilityModel) -> T): T {
            val model = try {
                factory(bytes)
            } catch (e: Exception) {
                throw ModelLoadException("can't open model: ${e.message}", e)
            }
            return try {
                wrap(model)
            } catch (e: IllegalArgumentException) {
                model.close()
                throw ModelLoadException(e.message ?: "model doesn't match its labels", e)
            }
        }

        /** [results] holds (predicted, expected) pairs. */
        private fun checkGolden(file: String, results: List<Pair<String, String>>) {
            val wrong = results.filter { (got, want) -> got != want }
            if (wrong.isNotEmpty()) {
                val (got, want) = wrong.first()
                throw ModelLoadException("$file: ${wrong.size} of ${results.size} wrong (expected $want, got $got)")
            }
        }
    }
}
