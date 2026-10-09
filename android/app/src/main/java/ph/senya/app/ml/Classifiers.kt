package ph.senya.app.ml

import ph.senya.app.core.Hand
import ph.senya.app.core.Prediction
import ph.senya.app.core.SequenceClassifier
import ph.senya.app.core.StaticClassifier
import ph.senya.app.core.predictionOf
import java.io.Closeable

class SignClassifier(private val model: ProbabilityModel, val labels: List<String>) : StaticClassifier, Closeable {
    init {
        require(model.inputShape.contentEquals(intArrayOf(1, Hand.FLOATS))) {
            "model.tflite input is ${model.inputShape.contentToString()}, expected [1, ${Hand.FLOATS}]"
        }
        require(model.outputSize == labels.size) {
            "model.tflite has ${model.outputSize} outputs but labels.json has ${labels.size} labels"
        }
    }

    override fun classify(landmarks: FloatArray): Prediction = predictionOf(model.predict(arrayOf(landmarks)), labels)

    override fun close() = model.close()
}

class MotionClassifier(private val model: ProbabilityModel, val labels: List<String>) : SequenceClassifier, Closeable {
    init {
        require(model.inputShape.contentEquals(intArrayOf(1, Hand.FRAMES, Hand.FLOATS))) {
            "motion.tflite input is ${model.inputShape.contentToString()}, expected [1, ${Hand.FRAMES}, ${Hand.FLOATS}]"
        }
        require(model.outputSize == labels.size) {
            "motion.tflite has ${model.outputSize} outputs but motion_labels.json has ${labels.size} labels"
        }
    }

    override fun classify(frames: Array<FloatArray>): Prediction = predictionOf(model.predict(arrayOf(frames)), labels)

    override fun close() = model.close()
}
