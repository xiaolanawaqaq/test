"use strict";

require("dotenv").config();

const http = require("http");
const fs = require("fs");
const path = require("path");
const { attachTransport } = require("./transport");
const { apiRouter, parseCookies, extractBearer } = require("./api-routes");

const root = path.resolve(__dirname, "..");
const port = Number(process.env.PORT || 8787);
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

const PUBLIC_FILES = new Set([
  "index.html", "online.html", "login.html",
  "client/network-client.js", "client/app-config.js",
  "client/api-client.js", "client/auth-client.js",
  "client/token-store.js", "client/native-shell.js",
  "shared/game-types.js",
]);

const PUBLIC_DIRS = ["client", "shared"];

function isPublic(relative) {
  if (PUBLIC_FILES.has(relative)) return true;
  for (const dir of PUBLIC_DIRS) {
    if (relative.startsWith(dir + "/") && relative.indexOf("..") === -1) return true;
  }
  return false;
}

const server = http.createServer((req, res) => {
  const requestPath = (req.url || "/").split("?")[0];

  if (requestPath === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
    return;
  }

  if (requestPath === "/ready") {
    const db = require("./db");
    db.ready().then(ok => {
      res.writeHead(ok ? 200 : 503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(ok ? "ready" : "not ready");
    }).catch(() => {
      res.writeHead(503, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("not ready");
    });
    return;
  }

  if (requestPath.startsWith("/api/")) {
    return apiRouter(req, res);
  }

  let relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  if (relative === "online") relative = "online.html";
  if (relative === "login") relative = "login.html";

  if (!isPublic(relative) || relative.includes("..")) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }

  const file = path.resolve(root, relative);
  if (file !== root && !file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(data);
  });
});

let dbReady = false;
async function startup() {
  try {
    const { run } = require("./migrate");
    await run();
    dbReady = true;
    console.log("Database migrations applied successfully.");
  } catch (e) {
    console.warn("Database not available — running without persistence:", e.message);
  }

  attachTransport(server, dbReady);
  server.listen(port, "0.0.0.0", () => {
    console.log(`Merge TD multiplayer server listening on port ${port}`);
  });
}

function shutdown() {
  console.log("Shutting down...");
  const db = require("./db");
  db.close().catch(() => {});
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

startup().catch(e => { console.error(e); process.exit(1); });
