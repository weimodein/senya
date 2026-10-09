package ph.senya.app.data

import android.content.Context
import ph.senya.app.BuildConfig
import ph.senya.app.ml.AssetModelSource
import ph.senya.app.ml.DirModelSource
import ph.senya.app.ml.ModelBundle
import ph.senya.app.ml.ModelLoadException
import ph.senya.app.ml.TfliteModel
import java.io.File

/** Settings + the installed model version (SharedPreferences) + bundled fallback (spec §5.2, §5.4). */
class ModelRepository(context: Context) {
    private val appContext = context.applicationContext
    private val prefs = appContext.getSharedPreferences("senya", Context.MODE_PRIVATE)
    private val updater = ModelUpdater(File(appContext.filesDir, "models"), TfliteModel::fromBytes)

    data class Loaded(val bundle: ModelBundle, val message: String?)

    init {
        // Older builds saved a LAN address here; the server now comes from the build (spec §0)
        prefs.edit().remove(KEY_LEGACY_SERVER_URL).apply()
    }

    /** Developer override for testing against a local server. Only debug builds read it. */
    var serverOverride: String
        get() = prefs.getString(KEY_SERVER_OVERRIDE, "") ?: ""
        set(value) = prefs.edit().putString(KEY_SERVER_OVERRIDE, value.trim()).apply()

    /** The deployed platform, set at build time (`senya.serverUrl`), unless a debug build overrides it. */
    val serverUrl: String
        get() = serverOverride.takeIf { BuildConfig.DEBUG && it.isNotBlank() } ?: BuildConfig.SERVER_URL

    var speakOnSpace: Boolean
        get() = prefs.getBoolean(KEY_SPEAK_ON_SPACE, false)
        set(value) = prefs.edit().putBoolean(KEY_SPEAK_ON_SPACE, value).apply()

    val installedVersion: Int get() = prefs.getInt(KEY_VERSION, 0)

    /** The downloaded model if it loads, else the bundled one. Throws only if the bundled model is broken too. */
    fun loadCurrent(): Loaded {
        val v = installedVersion
        var message: String? = null
        if (v != 0) {
            try {
                return Loaded(ModelBundle.load(v, DirModelSource(updater.installedDir(v)), TfliteModel::fromBytes), null)
            } catch (e: ModelLoadException) {
                message = "Model v$v failed to load (${e.message}); using the bundled model"
                prefs.edit().putInt(KEY_VERSION, 0).apply()
            }
        }
        return Loaded(ModelBundle.load(0, AssetModelSource(appContext.assets), TfliteModel::fromBytes), message)
    }

    /** Blocks on the network; call off the main thread. */
    fun checkForUpdate(): ModelUpdater.Result = updater.check(serverUrl, installedVersion).also {
        if (it is ModelUpdater.Result.Updated) prefs.edit().putInt(KEY_VERSION, it.bundle.version).apply()
    }

    companion object {
        private const val KEY_LEGACY_SERVER_URL = "server_url"
        private const val KEY_SERVER_OVERRIDE = "server_override"
        private const val KEY_SPEAK_ON_SPACE = "speak_on_space"
        private const val KEY_VERSION = "installed_version"
    }
}
