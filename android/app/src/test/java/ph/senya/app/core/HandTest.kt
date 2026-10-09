package ph.senya.app.core

import org.junit.Assert.assertEquals
import org.junit.Test

class HandTest {
    @Test
    fun shapesMatchContract() {
        assertEquals(21, Hand.POINTS)
        assertEquals(63, Hand.FLOATS)
        assertEquals(32, Hand.FRAMES)
    }
}
