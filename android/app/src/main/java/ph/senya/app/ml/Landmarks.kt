package ph.senya.app.ml

import com.google.mediapipe.tasks.vision.handlandmarker.HandLandmarkerResult
import ph.senya.app.core.Hand

object Landmarks {
    /** Flattens the first hand to [x0, y0, z0, x1, …] (contract §3 item 1), or null when no hand is seen. */
    fun fromResult(result: HandLandmarkerResult): FloatArray? {
        val hand = result.landmarks().firstOrNull() ?: return null
        if (hand.size != Hand.POINTS) return null
        val out = FloatArray(Hand.FLOATS)
        hand.forEachIndexed { i, p ->
            out[i * 3] = p.x()
            out[i * 3 + 1] = p.y()
            out[i * 3 + 2] = p.z()
        }
        return out
    }
}
