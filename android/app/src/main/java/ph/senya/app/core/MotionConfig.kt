package ph.senya.app.core

/** Values from motion_config.json (contract §3 item 8). Defaults are the contract's starting values. */
data class MotionConfig(
    val t: Int = Hand.FRAMES,
    val startSpeed: Float = 1.0f,
    val stopSpeed: Float = 0.5f,
    val stopHoldMs: Long = 200,
    val padMs: Long = 150,
    val minMs: Long = 300,
    val maxMs: Long = 2500,
    val maxMissing: Float = 0.25f,
    val minConfidence: Float = 0.7f,
    val replaceWindowMs: Long = 1000,
    val startShapes: Map<String, List<String>> = mapOf("J" to listOf("I"), "Z" to emptyList()),
)
