"use strict";

const crypto = require("crypto");
const authService = require("./services/auth");
const progressRepo = require("./repositories/progress-repo");

const MAX_BODY = 4096;
const RATE_WINDOW_MS = 60000;
const RATE_MAX = 20;
const rateMap = new Map();

function rateLimit(ip) {
  const now = Date.now();
  let entry = rateMap.get(ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    entry = { start: now, count: 0 };
    rateMap.set(ip, entry);
  }
  entry.count++;
  return entry.count <= RATE_MAX;
}

function parseCookies(raw) {
  const map = {};
  if (!raw) return map;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    map[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  }
  return map;
}

function extractBearer(req) {
  const header = req.headers["authorization"];
  if (header && header.startsWith("Bearer ")) return header.slice(7);
  const cookies = parseCookies(req.headers.cookie);
  return cookies["auth_token"] || null;
}

async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let length = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      length += chunk.length;
      if (length > MAX_BODY) { req.destroy(); return resolve(null); }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
      catch (_) { resolve(null); }
    });
    req.on("error", () => resolve(null));
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

function errorResponse(res, status, code, message) {
  json(res, status, { code, message });
}

async function apiRouter(req, res) {
  const ip = req.socket.remoteAddress || "unknown";
  if (!rateLimit(ip)) return errorResponse(res, 429, "rate_limited", "请求过于频繁");

  const path = (req.url || "").split("?")[0];
  const method = (req.method || "GET").toUpperCase();

  try {
    if (method === "POST" && path === "/api/auth/guest") {
      const body = await parseBody(req);
      if (!body) return errorResponse(res, 400, "invalid_body", "请求格式错误");
      const result = await authService.guestLogin(body.displayName);
      setAuthCookie(res, result.token);
      return json(res, 200, { user: sanitizeUser(result.user), token: result.token });
    }

    if (method === "POST" && path === "/api/auth/register") {
      const body = await parseBody(req);
      if (!body || !body.email || !body.password) return errorResponse(res, 400, "invalid_body", "请提供邮箱和密码");
      if (body.password.length < 8) return errorResponse(res, 400, "weak_password", "密码至少8位");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) return errorResponse(res, 400, "invalid_email", "邮箱格式不正确");
      try {
        const result = await authService.register(body.email, body.password, body.displayName);
        setAuthCookie(res, result.token);
        return json(res, 201, { user: sanitizeUser(result.user), token: result.token });
      } catch (e) {
        if (e.status === 409) return errorResponse(res, 409, e.code, "该邮箱已被注册");
        throw e;
      }
    }

    if (method === "POST" && path === "/api/auth/login") {
      const body = await parseBody(req);
      if (!body || !body.email || !body.password) return errorResponse(res, 400, "invalid_body", "请提供邮箱和密码");
      try {
        const result = await authService.login(body.email, body.password);
        setAuthCookie(res, result.token);
        return json(res, 200, { user: sanitizeUser(result.user), token: result.token });
      } catch (e) {
        if (e.status === 401) return errorResponse(res, 401, "invalid_credentials", "邮箱或密码错误");
        throw e;
      }
    }

    if (method === "POST" && path === "/api/auth/upgrade") {
      const token = extractBearer(req);
      let user;
      try { user = await authService.authenticate(token); } catch (e) { return errorResponse(res, e.status, e.code, e.message); }
      const body = await parseBody(req);
      if (!body || !body.email || !body.password) return errorResponse(res, 400, "invalid_body", "请提供邮箱和密码");
      if (!user.guest) return errorResponse(res, 400, "not_guest", "当前不是游客账号");
      try {
        const result = await authService.upgradeGuest(user.id, body.email, body.password, body.displayName);
        return json(res, 200, { user: sanitizeUser(result.user) });
      } catch (e) {
        if (e.status === 409) return errorResponse(res, 409, e.code, "该邮箱已被注册");
        throw e;
      }
    }

    if (method === "POST" && path === "/api/auth/logout") {
      const token = extractBearer(req);
      if (token) await authService.logout(token);
      clearAuthCookie(res);
      return json(res, 200, { ok: true });
    }

    if (method === "GET" && path === "/api/me") {
      const token = extractBearer(req);
      let user;
      try { user = await authService.authenticate(token); } catch (e) { return errorResponse(res, e.status, e.code, e.message); }
      return json(res, 200, sanitizeUser(user));
    }

    if (method === "POST" && path === "/api/me/name") {
      const token = extractBearer(req);
      let user;
      try { user = await authService.authenticate(token); } catch (e) { return errorResponse(res, e.status, e.code, e.message); }
      const body = await parseBody(req);
      if (!body || !body.displayName) return errorResponse(res, 400, "invalid_body", "请提供昵称");
      const updated = await authService.updateDisplayName(user.id, body.displayName);
      return json(res, 200, { user: sanitizeUser(updated) });
    }

    if (method === "GET" && path === "/api/me/progress") {
      const token = extractBearer(req);
      try { await authService.authenticate(token); } catch (e) { return errorResponse(res, e.status, e.code, e.message); }
      const p = await progressRepo.getOrCreate(token);
      return json(res, 200, sanitizeUser({}) );
    }

    if (method === "POST" && path === "/api/progress/solo") {
      const token = extractBearer(req);
      let user;
      try { user = await authService.authenticate(token); } catch (e) { return errorResponse(res, e.status, e.code, e.message); }
      const body = await parseBody(req);
      if (!body || !body.idempotentKey) return errorResponse(res, 400, "invalid_body", "缺少上报凭证");
      await progressRepo.recordSoloResult(user.id, body.level || 1, !!body.won, body.idempotentKey);
      return json(res, 200, { ok: true });
    }

  } catch (e) {
    if (e.status) return errorResponse(res, e.status, e.code || "error", e.message);
    console.error("API error:", e.message);
    return errorResponse(res, 500, "internal", "服务器内部错误");
  }

  return errorResponse(res, 404, "not_found", "接口不存在");
}

function sanitizeUser(u) {
  return {
    id: u.id,
    displayName: u.display_name || "玩家",
    email: u.email || null,
    guest: !!u.guest,
    createdAt: u.created_at,
  };
}

function setAuthCookie(res, token) {
  res.setHeader("Set-Cookie", `auth_token=${token}; HttpOnly; SameSite=Lax; Max-Age=2592000; Path=/`);
}

function clearAuthCookie(res) {
  res.setHeader("Set-Cookie", "auth_token=; HttpOnly; SameSite=Lax; Max-Age=0; Path=/");
}

module.exports = { apiRouter, parseCookies, extractBearer };
