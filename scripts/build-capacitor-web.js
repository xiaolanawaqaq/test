"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const WWW = path.join(ROOT, "www");

const ALLOW = new Set([
  "index.html",
  "online.html",
  "login.html",
]);

const ALLOW_DIRS = new Map([
  ["client", ["network-client.js", "app-config.js", "api-client.js", "auth-client.js", "token-store.js", "native-shell.js"]],
  ["shared", ["game-types.js"]],
]);

const DENY_FILES = new Set([
  "package.json", "package-lock.json", "railway.json", "Procfile",
  "RAILWAY.md", ".env", ".env.example", "capacitor.config.json",
]);

// clean
if (fs.existsSync(WWW)) {
  for (const name of fs.readdirSync(WWW)) {
    fs.rmSync(path.join(WWW, name), { recursive: true, force: true });
  }
} else {
  fs.mkdirSync(WWW, { recursive: true });
}

// copy allowed root files
for (const name of ALLOW) {
  const src = path.join(ROOT, name);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(WWW, name));
}

// copy allowed dir files
for (const [dir, files] of ALLOW_DIRS) {
  const destDir = path.join(WWW, dir);
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of files) {
    const src = path.join(ROOT, dir, name);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(destDir, name));
  }
}

// verify no sensitive files leaked
function verify(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(WWW, full).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      verify(full);
      continue;
    }
    if (DENY_FILES.has(entry.name)) {
      throw new Error(`Sensitive file leaked to www: ${rel}`);
    }
    if (rel.startsWith("server/") || rel.startsWith("scripts/") || rel.startsWith("node_modules/")) {
      throw new Error(`Server file leaked to www: ${rel}`);
    }
  }
}
verify(WWW);

const files = [];
function list(dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) { list(path.join(dir, entry.name), prefix + entry.name + "/"); continue; }
    files.push(prefix + entry.name);
  }
}
list(WWW, "");
console.log(`www/ built (${files.length} files): ${files.join(", ")}`);
