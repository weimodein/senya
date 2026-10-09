package ph.senya.app.core

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import ph.senya.app.ml.ModelJson
import java.io.File

class MotionSegmenterTest {
    private fun hand(cx: Float) = FloatArray(Hand.FLOATS).also {
        for (i in 0 until Hand.POINTS) {
            it[i * 3] = cx + 0.01f * i
            it[i * 3 + 1] = 0.5f
        }
    }

    /** Runs frames n = 0, 1, 2, … at t = 33·n; [cxAt] returns null for "no hand". */
    private fun run(seg: MotionSegmenter, count: Int, cxAt: (Int) -> Float?): List<Pair<Int, MotionSegmenter.Output>> =
        (0 until count).map { n -> n to seg.onFrame(33L * n, cxAt(n)?.let { hand(it) }) }

    private fun segments(outputs: List<Pair<Int, MotionSegmenter.Output>>) = outputs.mapNotNull { it.second.segment }

    /** still at 0.3 for n < 10, moving 0.03/frame for n in 10..29, still afterwards. */
    private fun oneMovement(n: Int): Float = 0.3f + 0.03f * (n.coerceIn(9, 29) - 9)

    @Test
    fun emitsOneSegmentForOneMovement() {
        val out = run(MotionSegmenter(), 45, ::oneMovement)
        val segs = segments(out)
        assertEquals(1, segs.size)
        val s = segs[0]
        assertEquals(180L, s.startMs)   // start 330 − pad 150
        assertEquals(1056L, s.endMs)    // first still frame below stop_speed (n = 32)
        assertEquals(Hand.FRAMES, s.frames.size)
        assertTrue(s.frames.all { it.size == Hand.FLOATS })
        assertEquals(0.3f, s.frames.first()[0], 1e-4f)
        assertEquals(0.9f, s.frames.last()[0], 1e-4f)
        for (k in 1 until Hand.FRAMES) assertTrue(s.frames[k][0] >= s.frames[k - 1][0] - 1e-6f)
        assertTrue(out[20].second.moving)
        assertFalse(out[44].second.moving)
        assertEquals(39, out.first { it.second.segment != null }.first)
    }

    @Test
    fun stillHandNeverMoves() {
        val out = run(MotionSegmenter(), 60) { 0.4f }
        assertTrue(out.none { it.second.moving })
        assertTrue(segments(out).isEmpty())
    }

    @Test
    fun tooShortMovementIgnored() {
        val seg = MotionSegmenter(MotionConfig(padMs = 0, minMs = 300))
        val out = run(seg, 40) { n -> 0.3f + 0.03f * (n.coerceIn(9, 12) - 9) }
        assertTrue(segments(out).isEmpty())
        assertFalse(out.last().second.moving)
    }

    @Test
    fun tooLongMovementIgnored() {
        val out = run(MotionSegmenter(), 140) { n -> 0.3f + 0.003f * (n.coerceIn(9, 109) - 9) * 10 }
        assertTrue(segments(out).isEmpty())
        assertFalse(out.last().second.moving)
    }

    @Test
    fun handLostEndsSegmentAtLastHandFrame() {
        val out = run(MotionSegmenter(), 46) { n -> if (n >= 30) null else oneMovement(n) }
        val segs = segments(out)
        assertEquals(1, segs.size)
        assertEquals(957L, segs[0].endMs)   // n = 29
        assertEquals(0.9f, segs[0].frames.last()[0], 1e-4f)
        assertEquals(36, out.first { it.second.segment != null }.first)
    }

    @Test
    fun tooManyMissingFramesDiscarded() {
        // During the movement every 3rd frame has no hand: 10 of 32 frames missing > 25 %
        val seg = MotionSegmenter(MotionConfig(padMs = 0))
        val out = run(seg, 60) { n ->
            when {
                n < 10 -> 0.3f
                n <= 39 -> if ((n - 10) % 3 == 2) null else 0.3f + 0.03f * (n - 9)
                else -> 0.3f + 0.03f * 30
            }
        }
        assertTrue(segments(out).isEmpty())
    }

    @Test
    fun someMissingFramesKept() {
        // Every 4th frame missing: 7 of 33 frames ≤ 25 %
        val seg = MotionSegmenter(MotionConfig(padMs = 0))
        val out = run(seg, 60) { n ->
            when {
                n < 10 -> 0.3f
                n <= 39 -> if ((n - 10) % 4 == 3) null else 0.3f + 0.03f * (n - 9)
                else -> 0.3f + 0.03f * 30
            }
        }
        assertEquals(1, segments(out).size)
    }

    @Test
    fun nonIncreasingTimestampsDoNotCrash() {
        val seg = MotionSegmenter()
        repeat(20) { seg.onFrame(1000L, hand(0.3f + 0.05f * it)) }
        repeat(20) { seg.onFrame(500L, hand(0.3f)) }
        repeat(5) { seg.onFrame(400L, null) }
    }

    @Test
    fun resampleInterpolatesAndClamps() {
        val frames = listOf(0L to FloatArray(Hand.FLOATS) { 0f }, 100L to FloatArray(Hand.FLOATS) { 10f })
        val out = MotionSegmenter.resample(frames, 0, 100, 3)
        assertArrayEquals(floatArrayOf(0f, 5f, 10f), floatArrayOf(out[0][0], out[1][0], out[2][62]), 1e-5f)
        val clamped = MotionSegmenter.resample(frames, -50, 150, 2)
        assertEquals(0f, clamped[0][0], 1e-5f)
        assertEquals(10f, clamped[1][0], 1e-5f)
    }

    /** Person B's fixture (CONTRACT.md §3 item 11). Skipped until B pushes it. */
    @Test
    fun matchesSharedFixture() {
        val file = File(System.getProperty("senya.fixtures") ?: "", "segmenter_case.json")
        assumeTrue("fixture not pushed yet: $file", file.isFile)
        val root = JSONObject(file.readText())
        val seg = MotionSegmenter(ModelJson.parseMotionConfig(root.getJSONObject("config").toString().toByteArray()))
        val stream = root.getJSONArray("stream")
        val got = (0 until stream.length()).mapNotNull { i ->
            val f = stream.getJSONObject(i)
            val lm = if (f.isNull("landmarks")) null else floats(f.getJSONArray("landmarks"))
            seg.onFrame(f.getLong("t_ms"), lm).segment
        }
        val expected = root.getJSONArray("expected_segments")
        assertEquals(expected.length(), got.size)
        for (i in got.indices) {
            val e = expected.getJSONObject(i)
            assertEquals(e.getLong("start_ms"), got[i].startMs)
            assertEquals(e.getLong("end_ms"), got[i].endMs)
            val frames = e.getJSONArray("frames")
            for (k in 0 until frames.length()) assertArrayEquals(floats(frames.getJSONArray(k)), got[i].frames[k], 1e-4f)
        }
    }

    private fun floats(a: JSONArray) = FloatArray(a.length()) { a.getDouble(it).toFloat() }
}
