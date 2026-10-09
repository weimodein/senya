package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Test

class FpsCounterTest {
    @Test
    fun countsFramesInLastSecond() {
        val fps = FpsCounter()
        var last = 0
        for (i in 0 until 90) last = fps.tick(i * 33L) // 30 fps for ~3 s
        assertEquals(31, last) // frames with t in [now - 1000, now]
    }
}
