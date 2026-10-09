package ph.senya.app.core

import kotlin.math.hypot

/** Finds hand movements and resamples each to 32 frames (contract §3 item 7). No Android imports. */
class MotionSegmenter(private val config: MotionConfig = MotionConfig()) {

    /** [startMs] is the movement start minus pad_ms; [frames] is T × 63, ready for the motion model. */
    class Segment(val startMs: Long, val endMs: Long, val frames: Array<FloatArray>)

    data class Output(val moving: Boolean, val segment: Segment?)

    private class Frame(val tMs: Long, val landmarks: FloatArray?)

    private val buffer = ArrayDeque<Frame>()
    private var prev: Frame? = null
    private val speeds = ArrayDeque<Float>()
    private var moving = false
    private var startMs = 0L
    private var belowSinceMs: Long? = null
    private var lastHandMs: Long? = null

    fun onFrame(tMs: Long, landmarks: FloatArray?): Output {
        val frame = Frame(tMs, landmarks)
        buffer.addLast(frame)
        while (tMs - buffer.first().tMs > config.maxMs + config.padMs + config.stopHoldMs) buffer.removeFirst()
        val smoothed = smoothedSpeed(frame)
        prev = frame
        if (landmarks != null) lastHandMs = tMs

        if (!moving) {
            if (smoothed != null && smoothed > config.startSpeed) {
                moving = true
                startMs = tMs
                belowSinceMs = null
            }
            return Output(moving, null)
        }

        val endMs: Long? = when {
            landmarks == null -> lastHandMs?.takeIf { tMs - it > config.stopHoldMs }
            smoothed == null -> null
            smoothed < config.stopSpeed -> {
                val since = belowSinceMs ?: tMs.also { belowSinceMs = it }
                since.takeIf { tMs - it >= config.stopHoldMs }
            }
            else -> {
                belowSinceMs = null
                null
            }
        }
        if (endMs == null) return Output(true, null)
        moving = false
        belowSinceMs = null
        return Output(false, buildSegment(startMs - config.padMs, endMs))
    }

    private fun smoothedSpeed(frame: Frame): Float? {
        val cur = frame.landmarks
        if (cur == null) {
            speeds.clear()
            return null
        }
        val before = prev?.landmarks ?: return null
        val dtSec = (frame.tMs - prev!!.tMs) / 1000f
        val size = handSize(cur)
        if (dtSec <= 0f || size <= 0f) return null
        var moved = 0f
        for (i in 0 until Hand.POINTS) moved += hypot(cur[i * 3] - before[i * 3], cur[i * 3 + 1] - before[i * 3 + 1])
        speeds.addLast(moved / Hand.POINTS / size / dtSec)
        while (speeds.size > 3) speeds.removeFirst()
        return speeds.sum() / speeds.size
    }

    private fun buildSegment(fromMs: Long, toMs: Long): Segment? {
        val duration = toMs - fromMs
        if (duration < config.minMs || duration > config.maxMs) return null
        val frames = buffer.filter { it.tMs in fromMs..toMs }
        if (frames.isEmpty()) return null
        val missing = frames.count { it.landmarks == null }.toFloat() / frames.size
        if (missing > config.maxMissing) return null
        val withHand = frames.mapNotNull { f -> f.landmarks?.let { f.tMs to it } }
        if (withHand.isEmpty()) return null
        return Segment(fromMs, toMs, resample(withHand, fromMs, toMs, config.t))
    }

    companion object {
        private fun handSize(p: FloatArray): Float {
            var max = 0f
            for (i in 1 until Hand.POINTS) max = maxOf(max, hypot(p[i * 3] - p[0], p[i * 3 + 1] - p[1]))
            return max
        }

        /** Linear interpolation at T evenly spaced times; clamps to the first/last frame at the edges. */
        fun resample(frames: List<Pair<Long, FloatArray>>, fromMs: Long, toMs: Long, t: Int): Array<FloatArray> =
            Array(t) { k ->
                val tk = fromMs + k * (toMs - fromMs).toDouble() / (t - 1)
                val after = frames.indexOfFirst { it.first >= tk }
                when (after) {
                    -1 -> frames.last().second.copyOf()
                    0 -> frames.first().second.copyOf()
                    else -> {
                        val (ta, a) = frames[after - 1]
                        val (tb, b) = frames[after]
                        val w = if (tb == ta) 1f else ((tk - ta) / (tb - ta)).toFloat()
                        FloatArray(a.size) { i -> a[i] + (b[i] - a[i]) * w }
                    }
                }
            }
    }
}
