package ph.senya.app.core

sealed class StabilizerEvent {
    data class Letter(val label: String) : StabilizerEvent()
    object Space : StabilizerEvent() {
        override fun toString() = "Space"
    }
    /** A motion letter replaces the start-shape letter just committed (e.g. I → J). */
    data class ReplaceLast(val label: String) : StabilizerEvent()
}
