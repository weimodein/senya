const crypto = require("crypto");

/** /api/ml/* routes: only the ML service, which sends the shared ML_API_KEY in X-API-Key. */
function apiKey(req, res, next) {
  const expected = process.env.ML_API_KEY || "";
  const given = req.headers["x-api-key"] || "";
  const ok =
    expected.length > 0 &&
    given.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  return ok ? next() : res.status(401).json({ message: "Unauthorized" });
}

module.exports = apiKey;
