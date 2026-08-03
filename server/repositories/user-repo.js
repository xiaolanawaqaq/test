"use strict";

const db = require("../db");

const userRepo = {
  async createGuest(displayName) {
    const name = displayName || null;
    const { rows } = await db.query(
      "INSERT INTO users (display_name, guest) VALUES ($1, true) RETURNING id, display_name, email, guest, created_at",
      [name]
    );
    return rows[0];
  },

  async createEmailUser(email, passwordHash, displayName) {
    const name = displayName || null;
    const { rows } = await db.query(
      "INSERT INTO users (email, display_name, password_hash, guest) VALUES ($1, $2, $3, false) RETURNING id, display_name, email, guest, created_at",
      [email.toLowerCase(), name, passwordHash]
    );
    return rows[0];
  },

  async findByEmail(email) {
    const { rows } = await db.query(
      "SELECT id, display_name, email, password_hash, guest, created_at FROM users WHERE email = $1",
      [email.toLowerCase()]
    );
    return rows[0] || null;
  },

  async findById(id) {
    const { rows } = await db.query(
      "SELECT id, display_name, email, guest, created_at FROM users WHERE id = $1",
      [id]
    );
    return rows[0] || null;
  },

  async upgradeGuestToEmail(id, email, passwordHash, displayName) {
    const name = displayName || null;
    const { rows } = await db.query(
      `UPDATE users SET email = $2, password_hash = $3, display_name = COALESCE($4, display_name), guest = false, updated_at = NOW()
       WHERE id = $1 AND guest = true
       RETURNING id, display_name, email, guest, created_at`,
      [id, email.toLowerCase(), passwordHash, name]
    );
    return rows[0] || null;
  },

  async updateDisplayName(id, displayName) {
    const { rows } = await db.query(
      "UPDATE users SET display_name = $2, updated_at = NOW() WHERE id = $1 RETURNING id, display_name, email, guest, created_at",
      [id, displayName]
    );
    return rows[0] || null;
  },
};

module.exports = userRepo;
