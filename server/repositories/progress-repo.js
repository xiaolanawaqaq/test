"use strict";

const db = require("../db");

const progressRepo = {
  async getOrCreate(userId) {
    const { rows } = await db.query(
      "INSERT INTO player_progress (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING RETURNING *",
      [userId]
    );
    if (rows.length > 0) return rows[0];
    const { rows: existing } = await db.query(
      "SELECT * FROM player_progress WHERE user_id = $1",
      [userId]
    );
    return existing[0] || null;
  },

  async recordSoloResult(userId, level, won, idempotentKey) {
    const result = won ? "win" : "lose";
    await db.transaction(async (client) => {
      let match = null;
      const { rows: existing } = await client.query(
        "SELECT id FROM matches WHERE match_idempotent_key = $1",
        [idempotentKey]
      );
      if (existing.length > 0) match = existing[0];
      else {
        const { rows: created } = await client.query(
          `INSERT INTO matches (mode, result, level_reached, player_count, match_idempotent_key)
           VALUES ('solo', $1, $2, 1, $3) RETURNING id`,
          [result, level, idempotentKey]
        );
        match = created[0];
        await client.query(
          "INSERT INTO match_players (match_id, user_id, result) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [match.id, userId, result]
        );
        await client.query(
          `UPDATE player_progress SET
             games_played = games_played + 1,
             games_won = games_won + CASE WHEN $1 THEN 1 ELSE 0 END,
             highest_level = GREATEST(highest_level, $2),
             updated_at = NOW()
           WHERE user_id = $3`,
          [won, level, userId]
        );
      }
    });
  },

  async recordMultiResult(userIds, mode, result, level, idempotentKey) {
    await db.transaction(async (client) => {
      const { rows: existing } = await client.query(
        "SELECT id FROM matches WHERE match_idempotent_key = $1",
        [idempotentKey]
      );
      if (existing.length > 0) return;

      const { rows: created } = await client.query(
        `INSERT INTO matches (mode, result, level_reached, player_count, match_idempotent_key)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [mode, result, level, userIds.length, idempotentKey]
      );
      const match = created[0];

      for (const uid of userIds) {
        const playerResult = result === "win" ? "win" : "lose";
        await client.query(
          "INSERT INTO match_players (match_id, user_id, result) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
          [match.id, uid, playerResult]
        );
        await client.query(
          `UPDATE player_progress SET
             games_played = games_played + 1,
             games_won = games_won + CASE WHEN $1 THEN 1 ELSE 0 END,
             highest_level = GREATEST(highest_level, $2),
             updated_at = NOW()
           WHERE user_id = $3`,
          [result === "win", level, uid]
        );
      }
    });
  },
};

module.exports = progressRepo;
