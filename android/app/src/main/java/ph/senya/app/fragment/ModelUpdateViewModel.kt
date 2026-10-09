package ph.senya.app.fragment

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.LiveData
import androidx.lifecycle.MutableLiveData
import ph.senya.app.data.ModelRepository
import ph.senya.app.data.UpdateFlow
import ph.senya.app.data.UpdateScreenState
import java.util.concurrent.Executors

/** Runs the update check off the main thread and survives configuration changes. Leaving the screen cancels it. */
class ModelUpdateViewModel(app: Application) : AndroidViewModel(app) {
    private val repository = ModelRepository(app)
    private val executor = Executors.newSingleThreadExecutor()
    private val _state = MutableLiveData<UpdateScreenState>()
    val state: LiveData<UpdateScreenState> = _state

    private val flow = UpdateFlow(
        check = { force, onStep, isCancelled -> repository.checkForUpdate(force, onStep, isCancelled) },
        currentInfo = { repository.currentInfo() },
        publish = { _state.postValue(it) },
    )

    init {
        start()
    }

    /** [force] re-downloads the installed version ("Retry motion model"). */
    fun start(force: Boolean = false) {
        executor.execute { flow.run(force) }
    }

    fun cancel() = flow.cancel()

    override fun onCleared() {
        flow.cancel()
        executor.shutdown()
    }
}
