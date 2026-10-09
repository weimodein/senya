package ph.senya.app.core

data class Prediction(val label: String, val confidence: Float)

/** Contract §3 item 5: this motion label means "not a sign" and is never committed. */
const val NONE_LABEL = "_none"

fun interface StaticClassifier {
    fun classify(landmarks: FloatArray): Prediction
}

fun interface SequenceClassifier {
    fun classify(frames: Array<FloatArray>): Prediction
}

fun predictionOf(probabilities: FloatArray, labels: List<String>): Prediction {
    var best = 0
    for (i in probabilities.indices) if (probabilities[i] > probabilities[best]) best = i
    return Prediction(labels[best], probabilities[best])
}
