package ph.senya.app.core

/** Frames seen in the last second, for the status line (spec §5.5 target: ≥ 15 fps). */
class FpsCounter(private val windowMs: Long = 1000) {
    private val times = ArrayDeque<Long>()

    fun tick(tMs: Long): Int {
        times.addLast(tMs)
        while (tMs - times.first() > windowMs) times.removeFirst()
        return times.size
    }
}
