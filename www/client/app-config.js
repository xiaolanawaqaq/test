"use strict";

const APP_CONFIG = (() => {
  const BUILD = (typeof BUILD_API_URL !== "undefined") ? BUILD_API_URL : null;
  let configured = null;

  try {
    if (typeof Capacitor !== "undefined" && Capacitor.Capacitor.getPlatform() !== "web") {
      const prefs = Capacitor.Preferences ? Capacitor.Preferences.get({ key: "server_url" }) : null;
      if (prefs) configured = prefs.value || null;
    }
  } catch (_) {}

  let url = configured || BUILD || null;
  if (!url && typeof location !== "undefined" && location.protocol.startsWith("http")) {
    url = location.origin;
  }
  return {
    apiUrl: url,
    wsUrl: url ? url.replace(/^http/, "ws") : null,
    needsSetup: !url,
  };
})();

if (typeof module !== "undefined") module.exports = { APP_CONFIG };
if (typeof window !== "undefined") window.APP_CONFIG = APP_CONFIG;
