package ph.senya.app.data

import org.json.JSONObject

/** GET /api/model/latest (contract §3 item 9). */
data class LatestModel(
    val version: Int,
    val modelUrl: String,
    val labelsUrl: String,
    val sha256: String,
    val motion: Motion?,
) {
    data class Motion(val modelUrl: String, val labelsUrl: String, val configUrl: String, val sha256: String)

    companion object {
        /** Throws org.json.JSONException on bad input. */
        fun parse(json: String): LatestModel {
            val o = JSONObject(json)
            val m = o.optJSONObject("motion") // null when missing or JSON null
            return LatestModel(
                version = o.getInt("version"),
                modelUrl = o.getString("model_url"),
                labelsUrl = o.getString("labels_url"),
                sha256 = o.getString("sha256"),
                motion = m?.let {
                    Motion(it.getString("model_url"), it.getString("labels_url"), it.getString("config_url"), it.getString("sha256"))
                },
            )
        }
    }
}
