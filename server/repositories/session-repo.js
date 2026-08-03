"use strict";

const crypto = require("crypto");
const db = require("../db");

function hashToken(token) {
  return crypto.createHmac("sha256", process.env.TOKEN_PEPPER || "default-pepper").update(token).digest("hex");
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

const sessionRepo = {
  async create(userId) {
    const token = generateToken();
    const hashed = hashToken(token);
    await db.query(
      "INSERT INTO auth_sessions (user_id, token_hash) VALUES ($1, $2)",
      [userId, hashed]
    );
    return token;
  },

  async validate(token) {
    const hashed = hashToken(token);
    const { rows } = await db.query(
      `SELECT u.id, u.display_name, u.email, u.guest, u.created_at
       FROM auth_sessions s JOIN users u ON s.user_id = u.id
       WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
      [hashed]
    );
    return rows[0] || null;
  },

  async revoke(token) {
    const hashed = hashToken(token);
    await db.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashed]);
  },

  async revokeAllForUser(userId) {
    await db.query("DELETE FROM auth_sessions WHERE user_id = $1", [userId]);
  },
};

module.exports = sessionRepo;
