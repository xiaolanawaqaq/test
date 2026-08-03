"use strict";

const AuthClient = (() => {
  let currentUser = null;
  let token = null;
  const listeners = [];

  function notify() {
    for (const fn of listeners) {
      try { fn(currentUser); } catch (_) {}
    }
  }

  async function init() {
    const stored = await TokenStore.load();
    if (!stored.token || !stored.user) return false;
    try {
      const user = await ApiClient.get("/api/me", { token: stored.token });
      currentUser = user;
      token = stored.token;
      notify();
      return true;
    } catch (e) {
      if (e.status === 401) await TokenStore.clear();
      return false;
    }
  }

  async function guestLogin(displayName) {
    const name = (displayName || "").trim().slice(0, 20) || null;
    const data = await ApiClient.post("/api/auth/guest", name ? { displayName: name } : {});
    currentUser = data.user;
    token = data.token;
    await TokenStore.save(token, currentUser);
    notify();
    return currentUser;
  }

  async function register(email, password, displayName) {
    const data = await ApiClient.post("/api/auth/register", { email, password, displayName });
    currentUser = data.user;
    token = data.token;
    await TokenStore.save(token, currentUser);
    notify();
    return currentUser;
  }

  async function login(email, password) {
    const data = await ApiClient.post("/api/auth/login", { email, password });
    currentUser = data.user;
    token = data.token;
    await TokenStore.save(token, currentUser);
    notify();
    return currentUser;
  }

  async function upgradeGuest(email, password, displayName) {
    const data = await ApiClient.post("/api/auth/upgrade", { email, password, displayName }, { token });
    currentUser = data.user;
    await TokenStore.save(token, currentUser);
    notify();
    return currentUser;
  }

  async function logout() {
    try { await ApiClient.post("/api/auth/logout", {}, { token }); } catch (_) {}
    currentUser = null;
    token = null;
    await TokenStore.clear();
    notify();
  }

  async function updateDisplayName(name) {
    const data = await ApiClient.post("/api/me/name", { displayName: name }, { token });
    currentUser = data.user;
    await TokenStore.save(token, currentUser);
    notify();
    return currentUser;
  }

  async function getProgress() {
    const data = await ApiClient.get("/api/me/progress", { token });
    return data;
  }

  function getUser() { return currentUser; }
  function getToken() { return token; }
  function onUserChange(fn) { listeners.push(fn); }

  return {
    init, guestLogin, register, login, upgradeGuest, logout,
    updateDisplayName, getProgress, getUser, getToken, onUserChange,
  };
})();

if (typeof module !== "undefined") module.exports = { AuthClient };
if (typeof window !== "undefined") window.AuthClient = AuthClient;
