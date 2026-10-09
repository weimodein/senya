const jwt = require("jsonwebtoken");

/** Admin panel routes: `Authorization: Bearer <jwt>` from POST /api/auth/login. */
function auth(req, res, next) {
  const header = req.headers.authorization || "";
  if (!header.startsWith("Bearer ")) return res.status(401).json({ message: "No token provided" });
  try {
    req.admin = jwt.verify(header.slice(7), process.env.JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
}

module.exports = auth;
