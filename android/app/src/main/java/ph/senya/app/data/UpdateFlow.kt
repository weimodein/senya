package ph.senya.app.data

import ph.senya.app.ml.ModelInfo
import kotlin.math.roundToInt

/** What the model update screen shows (M3 mockup). [current] is the model in use while this state is shown. */
sealed class UpdateScreenState {
    abstract val current: ModelInfo?

    data class Checking(override val current: ModelInfo?) : UpdateScreenState()
    data class Downloading(
        override val current: ModelInfo?,
        val version: Int,
        val staticPercent: Int,
        val motionPercent: Int?,
    ) : UpdateScreenState()
    data class Verifying(
        override val current: ModelInfo?,
        val version: Int,
        val static: ModelUpdater.Part,
        val motion: ModelUpdater.Part?,
    ) : UpdateScreenState()
    data class Updated(override val current: ModelInfo, val from: Int, val to: Int) : UpdateScreenState()
    /** The server published an older version than the installed one (an admin rolled back). */
    data class RolledBack(override val current: ModelInfo, val from: Int, val to: Int) : UpdateScreenState()
    data class StaticOnly(override val current: ModelInfo, val reason: String) : UpdateScreenState()
    data class UpToDate(override val current: ModelInfo?) : UpdateScreenState()
    data class NoModelPublished(override val current: ModelInfo?) : UpdateScreenState()
    data class Failed(override val current: ModelInfo?, val reason: String) : UpdateScreenState()
    data class Cancelled(override val current: ModelInfo?) : UpdateScreenState()
}

/** Runs one update check and turns its progress and result into screen states. No Android imports. */
class UpdateFlow(
    private val check: (force: Boolean, onStep: (ModelUpdater.Step) -> Unit, isCancelled: () -> Boolean) -> ModelUpdater.Result,
    private val currentInfo: () -> ModelInfo?,
    private val publish: (UpdateScreenState) -> Unit,
) {
    @Volatile private var cancelled = false
    private var last: UpdateScreenState? = null

    /** From any thread. The running check stops at its next chunk, and nothing is installed after this. */
    fun cancel() {
        cancelled = true
    }

    /** Blocks on the network; call on one background thread. */
    fun run(force: Boolean = false) {
        cancelled = false
        last = null
        val before = currentInfo()
        emit(UpdateScreenState.Checking(before))
        val result = check(force, { step -> if (!cancelled) emit(stateFor(step, before)) }, { cancelled })
        emit(stateFor(result, before))
    }

    private fun emit(state: UpdateScreenState) {
        if (state == last) return
        last = state
        publish(state)
    }

    private fun stateFor(step: ModelUpdater.Step, before: ModelInfo?): UpdateScreenState = when (step) {
        is ModelUpdater.Step.Checking -> UpdateScreenState.Checking(before)
        is ModelUpdater.Step.Downloading ->
            UpdateScreenState.Downloading(before, step.version, percent(step.static), step.motion?.let { percent(it) })
        is ModelUpdater.Step.Verifying -> UpdateScreenState.Verifying(before, step.version, step.static, step.motion)
    }

    private fun stateFor(result: ModelUpdater.Result, before: ModelInfo?): UpdateScreenState = when (result) {
        is ModelUpdater.Result.Updated -> {
            // The camera screen loads the new version from disk; this copy only describes it
            val info = result.bundle.use { ModelInfo.of(it) }
            val from = before?.version ?: 0
            val motionError = result.motionError
            when {
                motionError != null -> UpdateScreenState.StaticOnly(info, motionError)
                info.version < from -> UpdateScreenState.RolledBack(info, from, info.version)
                else -> UpdateScreenState.Updated(info, from, info.version)
            }
        }
        is ModelUpdater.Result.UpToDate -> UpdateScreenState.UpToDate(before)
        is ModelUpdater.Result.NoModelPublished -> UpdateScreenState.NoModelPublished(before)
        is ModelUpdater.Result.Failed -> UpdateScreenState.Failed(before, result.message)
        is ModelUpdater.Result.Cancelled -> UpdateScreenState.Cancelled(before)
    }

    private fun percent(fraction: Float) = (fraction * 100).roundToInt().coerceIn(0, 100)
}
