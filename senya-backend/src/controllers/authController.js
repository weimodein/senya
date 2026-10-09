const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Admin } = require("../models/index.js");
const { HttpError } = require("../middleware/errors.js");

// Compared against when the username doesn't exist, so a wrong username and a wrong password take the same time.
const DUMMY_HASH = bcrypt.hashSync("no-such-admin", 10);

const publicAdmin = (a) => ({ id: a.id, username: a.username });

// POST /api/auth/login {username, password} -> {token, admin}
const login = async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== "string" || typeof password !== "string") {
    throw new HttpError(400, "username and password are required");
  }
  const admin = await Admin.findOne({ where: { username: username.trim() } });
  const ok = await bcrypt.compare(password, admin ? admin.password_hash : DUMMY_HASH);
  if (!admin || !ok) throw new HttpError(401, "Wrong username or password");
  const token = jwt.sign(publicAdmin(admin), process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "12h",
  });
  res.json({ token, admin: publicAdmin(admin) });
};

// GET /api/auth/me
const me = async (req, res) => {
  const admin = await Admin.findByPk(req.admin.id);
  if (!admin) throw new HttpError(401, "Account no longer exists");
  res.json(publicAdmin(admin));
};

/** Creates the admin from ADMIN_USERNAME / ADMIN_PASSWORD, or updates its password. Runs on every start. */
async function seedAdmin() {
  const username = process.env.ADMIN_USERNAME;
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) throw new Error("ADMIN_USERNAME and ADMIN_PASSWORD must be set");
  const password_hash = await bcrypt.hash(password, 10);
  const [admin, created] = await Admin.findOrCreate({ where: { username }, defaults: { password_hash } });
  if (!created && !(await bcrypt.compare(password, admin.password_hash))) await admin.update({ password_hash });
}

module.exports = { login, me, seedAdmin };
