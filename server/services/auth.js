"use strict";

const crypto = require("crypto");
const { promisify } = require("util");
const userRepo = require("../repositories/user-repo");
const sessionRepo = require("../repositories/session-repo");

const scrypt = promisify(crypto.scrypt);
const SCRYPT_VERSION = "v1";
const SCRYPT_N = 65536;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 128 * 1024 * 1024 };

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LENGTH, SCRYPT_OPTIONS);
  return `scrypt$${SCRYPT_VERSION}$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

async function verifyPassword(storedHash, password) {
  const parts = storedHash.split("$");
  if (parts.length !== 7 || parts[0] !== "scrypt" || parts[1] !== SCRYPT_VERSION) return false;

  const [, , nText, rText, pText, saltHex, hashHex] = parts;
  if (nText !== String(SCRYPT_N) || rText !== String(SCRYPT_R) || pText !== String(SCRYPT_P)) return false;
  if (!/^[0-9a-f]{32}$/i.test(saltHex) || !/^[0-9a-f]{128}$/i.test(hashHex)) return false;

  const expected = Buffer.from(hashHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, SCRYPT_OPTIONS);
  return crypto.timingSafeEqual(expected, actual);
}

const authService = {
  async guestLogin(displayName) {
    const user = await userRepo.createGuest(displayName);
    const token = await sessionRepo.create(user.id);
    return { user, token };
  },

  async register(email, password, displayName) {
    const existing = await userRepo.findByEmail(email);
    if (existing) throw { status: 409, code: "email_taken", message: "该邮箱已被注册" };

    const hash = await hashPassword(password);
    const user = await userRepo.createEmailUser(email, hash, displayName);
    const token = await sessionRepo.create(user.id);
    return { user, token };
  },

  async login(email, password) {
    const user = await userRepo.findByEmail(email);
    if (!user || !user.password_hash) throw { status: 401, code: "invalid_credentials", message: "邮箱或密码错误" };

    let valid;
    try { valid = await verifyPassword(user.password_hash, password); } catch (_) { valid = false; }
    if (!valid) throw { status: 401, code: "invalid_credentials", message: "邮箱或密码错误" };

    await sessionRepo.revokeAllForUser(user.id);
    const token = await sessionRepo.create(user.id);
    return {
      user: { id: user.id, display_name: user.display_name, email: user.email, guest: user.guest, created_at: user.created_at },
      token,
    };
  },

  async upgradeGuest(userId, email, password, displayName) {
    const existing = await userRepo.findByEmail(email);
    if (existing) throw { status: 409, code: "email_taken", message: "该邮箱已被注册" };

    const hash = await hashPassword(password);
    const user = await userRepo.upgradeGuestToEmail(userId, email, hash, displayName);
    if (!user) throw { status: 400, code: "not_guest", message: "当前不是游客账号" };
    return { user };
  },

  async authenticate(token) {
    if (!token) throw { status: 401, code: "unauthorized", message: "未登录" };
    const user = await sessionRepo.validate(token);
    if (!user) throw { status: 401, code: "session_expired", message: "登录已过期，请重新登录" };
    return user;
  },

  async logout(token) {
    if (token) await sessionRepo.revoke(token);
  },

  async updateDisplayName(userId, displayName) {
    const user = await userRepo.updateDisplayName(userId, displayName);
    if (!user) throw { status: 404, code: "not_found", message: "用户不存在" };
    return user;
  },
};

module.exports = authService;
