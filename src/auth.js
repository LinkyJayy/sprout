import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { db, isUniqueViolation, now } from "./db.js";

const COOKIE = "sprout_session";
const SESSION_DAYS = 30;
const DUMMY_HASH = bcrypt.hashSync("sprout-timing-guard", 12);
const hashToken = (t) => createHash("sha256").update(t).digest("hex");

export const publicUser = (u) =>
  u && { id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.created_at };

export async function createUser({ email, name, password }) {
  const hash = await bcrypt.hash(password, 12);
  const params = [email, name, hash];
  // The first account ever created becomes the owner. A partial unique index
  // guarantees only one owner exists, so a race simply falls back to 'reader'.
  try {
    return await db.get(
      `INSERT INTO users (email, name, password_hash, role, created_at)
       VALUES (?, ?, ?, CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 'owner' ELSE 'reader' END, ?)
       RETURNING *`,
      [...params, now()]
    );
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await db.get("SELECT id FROM users WHERE email = ?", [email]);
    if (existing) throw Object.assign(new Error("An account with that email already exists."), { status: 409 });
    return db.get(
      `INSERT INTO users (email, name, password_hash, role, created_at) VALUES (?, ?, ?, 'reader', ?) RETURNING *`,
      [...params, now()]
    );
  }
}

export async function verifyLogin(email, password) {
  const user = await db.get("SELECT * FROM users WHERE email = ?", [email]);
  if (!user) {
    await bcrypt.compare(password, DUMMY_HASH); // keep timing similar
    return null;
  }
  return (await bcrypt.compare(password, user.password_hash)) ? user : null;
}

export async function startSession(req, res, userId) {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.run("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)", [
    hashToken(token),
    userId,
    expires.toISOString(),
    now(),
  ]);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.secure, // true behind Railway's HTTPS proxy (trust proxy is on)
    expires,
    path: "/",
  });
}

export async function endSession(req, res) {
  const token = req.cookies?.[COOKIE];
  if (token) await db.run("DELETE FROM sessions WHERE token_hash = ?", [hashToken(token)]);
  res.clearCookie(COOKIE, { path: "/" });
}

// Attaches req.user when a valid session cookie is present. Never blocks.
export async function loadUser(req, _res, next) {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) {
      const row = await db.get(
        `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token_hash = ? AND s.expires_at > ?`,
        [hashToken(token), now()]
      );
      if (row) req.user = row;
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in to use this feature." });
  next();
}

export function requireOwner(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Sign in required." });
  if (req.user.role !== "owner") return res.status(403).json({ error: "Only the Sprout owner can do that." });
  next();
}

export async function pruneSessions() {
  await db.run("DELETE FROM sessions WHERE expires_at <= ?", [now()]);
}
