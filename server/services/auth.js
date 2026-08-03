"use strict";

const argon2 = require("argon2");
const userRepo = require("../repositories/user-repo");
const sessionRepo = require("../repositories/session-repo");

const authService = {
  async guestLogin(displayName) {
    const user = await userRepo.createGuest(displayName);
    const token = await sessionRepo.create(user.id);
    return { user, token };
  },

  async register(email, password, displayName) {
    const existing = await userRepo.findByEmail(email);
    if (existing) throw { status: 409, code: "email_taken", message: "该邮箱已被注册" };

    const hash = await argon2.hash(password);
    const user = await userRepo.createEmailUser(email, hash, displayName);
    const token = await sessionRepo.create(user.id);
    return { user, token };
  },

  async login(email, password) {
    const user = await userRepo.findByEmail(email);
    if (!user || !user.password_hash) throw { status: 401, code: "invalid_credentials", message: "邮箱或密码错误" };

    let valid;
    try { valid = await argon2.verify(user.password_hash, password); } catch (_) { valid = false; }
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

    const hash = await argon2.hash(password);
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
