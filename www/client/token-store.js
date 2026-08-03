"use strict";

const TokenStore = (() => {
  const KEY = "tafangames.auth.token";
  const USER_KEY = "tafangames.auth.user";

  let memoryToken = null;
  let memoryUser = null;

  function isNative() {
    try {
      return typeof Capacitor !== "undefined" && Capacitor.Capacitor.getPlatform() !== "web";
    } catch (_) { return false; }
  }

  async function save(token, user) {
    memoryToken = token;
    memoryUser = user;
    if (isNative()) {
      try {
        await Capacitor.Preferences.set({ key: KEY, value: token });
        await Capacitor.Preferences.set({ key: USER_KEY, value: JSON.stringify(user) });
      } catch (_) {}
    } else {
      try { localStorage.setItem(KEY, token); } catch (_) {}
      try { localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch (_) {}
    }
  }

  async function load() {
    if (memoryToken) return { token: memoryToken, user: memoryUser };
    let token = null, user = null;
    if (isNative()) {
      try {
        const t = await Capacitor.Preferences.get({ key: KEY });
        const u = await Capacitor.Preferences.get({ key: USER_KEY });
        token = (t && t.value) || null;
        if (u && u.value) {
          try { user = JSON.parse(u.value); } catch (_) {}
        }
      } catch (_) {}
    } else {
      try { token = localStorage.getItem(KEY); } catch (_) {}
      try { user = JSON.parse(localStorage.getItem(USER_KEY)); } catch (_) {}
    }
    memoryToken = token;
    memoryUser = user;
    return { token, user };
  }

  async function clear() {
    memoryToken = null;
    memoryUser = null;
    if (isNative()) {
      try { await Capacitor.Preferences.remove({ key: KEY }); } catch (_) {}
      try { await Capacitor.Preferences.remove({ key: USER_KEY }); } catch (_) {}
    } else {
      try { localStorage.removeItem(KEY); } catch (_) {}
      try { localStorage.removeItem(USER_KEY); } catch (_) {}
    }
  }

  return { save, load, clear, isNative };
})();

if (typeof module !== "undefined") module.exports = { TokenStore };
if (typeof window !== "undefined") window.TokenStore = TokenStore;
