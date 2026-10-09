// One error shape everywhere: { message } with a 4xx/5xx status.
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Express 4 doesn't catch rejected promises: wrap every async handler. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/** Parses :id-style params; anything that isn't a whole number is simply "not found". */
const intParam = (value) => {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new HttpError(404, "not found");
  return n;
};

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) return res.status(err.status).json({ message: err.message });
  if (err.type === "entity.too.large" || err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ message: "file or request too large" });
  }
  if (err.name === "MulterError") return res.status(400).json({ message: err.message });
  console.error(err);
  res.status(500).json({ message: "Server error" });
}

module.exports = { HttpError, wrap, intParam, errorHandler };
