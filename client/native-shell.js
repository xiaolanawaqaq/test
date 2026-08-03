"use strict";

const NativeShell = (() => {
  let statusBarStyle = "dark";

  function isNative() {
    try {
      return typeof Capacitor !== "undefined" && Capacitor.Capacitor.getPlatform() !== "web";
    } catch (_) { return false; }
  }

  async function setStatusBar(dark) {
    statusBarStyle = dark ? "dark" : "light";
    if (!isNative()) return;
    try {
      const StatusBar = Capacitor.Plugins && Capacitor.Plugins.StatusBar;
      if (StatusBar) {
        await StatusBar.setStyle({ style: statusBarStyle === "dark" ? "DARK" : "LIGHT" });
        if (dark) await StatusBar.setBackgroundColor({ color: "#1a2018" });
      }
    } catch (_) {}
  }

  async function keepScreenOn(on) {
    if (!isNative()) return;
    try {
      const WakeLock = Capacitor.Plugins && Capacitor.Plugins.ScreenOrientation;
      if (on && Capacitor.KeepAwake) {
        await Capacitor.KeepAwake.keepAwake({ isOn: true });
      } else if (!on && Capacitor.KeepAwake) {
        await Capacitor.KeepAwake.allowSleep({ isOn: true });
      }
    } catch (_) {}
  }

  async function lockOrientation() {
    if (!isNative()) return;
    try {
      const ScreenOrientation = Capacitor.Plugins && Capacitor.Plugins.ScreenOrientation;
      if (ScreenOrientation) {
        await ScreenOrientation.lock({ orientation: "portrait" });
      }
    } catch (_) {}
  }

  function getPlatform() {
    if (!isNative()) return "web";
    try {
      const p = Capacitor.Capacitor.getPlatform();
      if (p === "ios") return "ios";
      if (p === "android") return "android";
      return p;
    } catch (_) { return "web"; }
  }

  return { isNative, setStatusBar, keepScreenOn, lockOrientation, getPlatform };
})();

if (typeof module !== "undefined") module.exports = { NativeShell };
if (typeof window !== "undefined") window.NativeShell = NativeShell;
