/* ============================================================
 * HCIA-AI Solution 题库刷题平台 —— 本地服务端
 * 依赖：better-sqlite3（已在 package.json 中）
 * 启动：node server.js   （默认 http://127.0.0.1:8787）
 * ============================================================ */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "0.0.0.0";
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, "hcia.db"));
db.pragma("journal_mode = WAL");
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  pwd_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS progress (
  user_id INTEGER PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
`);

/* ---------------- 工具 ---------------- */
function nowISO() { return new Date().toISOString(); }
function hashPwd(pwd, salt) {
  return crypto.scryptSync(String(pwd), salt, 64).toString("hex");
}
function newToken() { return crypto.randomBytes(32).toString("hex"); }
function validName(u) {
  return /^[一-龥A-Za-z0-9_.-]{2,20}$/.test(u || "");
}
function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": b.length,
    "Cache-Control": "no-store"
  });
  res.end(b);
}

/* ---------------- Cookie / Session ---------------- */
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(";").forEach(function (p) {
    const i = p.indexOf("=");
    if (i < 0) return;
    out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
const SESSION_DAYS = 30;
const stmts = {
  findUser: db.prepare("SELECT id, username FROM users WHERE username = ?"),
  addUser: db.prepare("INSERT INTO users (username, pwd_hash, salt, created_at) VALUES (?,?,?,?)"),
  getUser: db.prepare("SELECT id, username, pwd_hash, salt FROM users WHERE id = ?"),
  addSession: db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?,?,?,?)"),
  getSession: db.prepare("SELECT s.token, s.user_id, s.expires_at, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?"),
  delSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  cleanSession: db.prepare("DELETE FROM sessions WHERE expires_at < ?"),
  getProgress: db.prepare("SELECT data, updated_at FROM progress WHERE user_id = ?"),
  setProgress: db.prepare(
    "INSERT INTO progress (user_id, data, updated_at) VALUES (?,?,?) " +
    "ON CONFLICT(user_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at"
  )
};

function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  const s = stmts.getSession.get(token);
  if (!s) return null;
  if (new Date(s.expires_at).getTime() < Date.now()) {
    stmts.delSession.run(token);
    return null;
  }
  return { id: s.user_id, username: s.username, token: token };
}
function setCookie(res, token) {
  res.setHeader("Set-Cookie",
    "sid=" + token + "; Path=/; HttpOnly; SameSite=Lax; Max-Age=" + SESSION_DAYS * 86400);
}
function clearCookie(res) {
  res.setHeader("Set-Cookie", "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
}

/* ---------------- 请求体 ---------------- */
function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on("data", function (c) {
    size += c.length;
    if (size > 2 * 1024 * 1024) { req.destroy(); return; }
    chunks.push(c);
  });
  req.on("end", function () {
    if (!chunks.length) return cb(null, {});
    try { cb(null, JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
    catch (e) { cb(e); }
  });
  req.on("error", function (e) { cb(e); });
}

/* ---------------- API ---------------- */
function handleApi(req, res, url) {
  const u = currentUser(req);

  if (url.pathname === "/api/me") {
    return json(res, 200, { ok: true, user: u ? { id: u.id, username: u.username } : null });
  }

  if (url.pathname === "/api/register" && req.method === "POST") {
    return readBody(req, function (err, b) {
      if (err) return json(res, 400, { ok: false, msg: "请求格式错误" });
      const name = String(b.username || "").trim();
      const pwd = String(b.password || "");
      if (!validName(name)) return json(res, 400, { ok: false, msg: "用户名需 2-20 位（中英文/数字/_.-）" });
      if (pwd.length < 6) return json(res, 400, { ok: false, msg: "密码至少 6 位" });
      if (stmts.findUser.get(name)) return json(res, 400, { ok: false, msg: "该用户名已被注册" });
      const salt = crypto.randomBytes(16).toString("hex");
      const info = stmts.addUser.run(name, hashPwd(pwd, salt), salt, nowISO());
      const token = newToken();
      stmts.addSession.run(token, info.lastInsertRowid, nowISO(),
        new Date(Date.now() + SESSION_DAYS * 86400000).toISOString());
      setCookie(res, token);
      json(res, 200, { ok: true, user: { id: Number(info.lastInsertRowid), username: name } });
    });
  }

  if (url.pathname === "/api/login" && req.method === "POST") {
    return readBody(req, function (err, b) {
      if (err) return json(res, 400, { ok: false, msg: "请求格式错误" });
      const name = String(b.username || "").trim();
      const pwd = String(b.password || "");
      const row = db.prepare("SELECT id, username, pwd_hash, salt FROM users WHERE username = ?").get(name);
      if (!row || hashPwd(pwd, row.salt) !== row.pwd_hash) {
        return json(res, 401, { ok: false, msg: "用户名或密码错误" });
      }
      const token = newToken();
      stmts.addSession.run(token, row.id, nowISO(),
        new Date(Date.now() + SESSION_DAYS * 86400000).toISOString());
      setCookie(res, token);
      json(res, 200, { ok: true, user: { id: row.id, username: row.username } });
    });
  }

  if (url.pathname === "/api/logout" && req.method === "POST") {
    if (u) stmts.delSession.run(u.token);
    clearCookie(res);
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/state") {
    if (!u) return json(res, 401, { ok: false, msg: "未登录" });
    if (req.method === "GET") {
      const row = stmts.getProgress.get(u.id);
      return json(res, 200, {
        ok: true,
        data: row ? row.data : null,
        updatedAt: row ? row.updated_at : null
      });
    }
    if (req.method === "POST") {
      return readBody(req, function (err, b) {
        if (err) return json(res, 400, { ok: false, msg: "请求格式错误" });
        let data = b && typeof b.data === "string" ? b.data : JSON.stringify(b && b.data ? b.data : {});
        if (data.length > 4 * 1024 * 1024) return json(res, 413, { ok: false, msg: "数据过大" });
        const ts = nowISO();
        stmts.setProgress.run(u.id, data, ts);
        json(res, 200, { ok: true, updatedAt: ts });
      });
    }
  }

  if (url.pathname === "/api/account" && req.method === "POST" && u) {
    // 修改密码
    return readBody(req, function (err, b) {
      if (err) return json(res, 400, { ok: false, msg: "请求格式错误" });
      const row = stmts.getUser.get(u.id);
      if (hashPwd(String(b.oldPassword || ""), row.salt) !== row.pwd_hash) {
        return json(res, 400, { ok: false, msg: "原密码不正确" });
      }
      const np = String(b.newPassword || "");
      if (np.length < 6) return json(res, 400, { ok: false, msg: "新密码至少 6 位" });
      const salt = crypto.randomBytes(16).toString("hex");
      db.prepare("UPDATE users SET pwd_hash = ?, salt = ? WHERE id = ?").run(hashPwd(np, salt), salt, u.id);
      db.prepare("DELETE FROM sessions WHERE user_id = ? AND token <> ?").run(u.id, u.token);
      json(res, 200, { ok: true });
    });
  }

  return json(res, 404, { ok: false, msg: "接口不存在" });
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8"
};

function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/" || p === "") p = "/index.html";
  const full = path.join(ROOT, p);
  if (!full.startsWith(ROOT)) return json(res, 403, { ok: false, msg: "禁止访问" });
  const rel = path.relative(ROOT, full);
  if (rel.startsWith("data") || rel.startsWith("node_modules")) {
    return json(res, 403, { ok: false, msg: "禁止访问" });
  }
  fs.stat(full, function (err, st) {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("404 Not Found");
    }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Length": st.size,
      "Cache-Control": "no-cache"
    });
    fs.createReadStream(full).pipe(res);
  });
}

/* ---------------- 服务器 ---------------- */
const server = http.createServer(function (req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Vary", "Origin");
  }
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }

  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
  if (url.pathname.indexOf("/api/") === 0) return handleApi(req, res, url);
  serveStatic(req, res, url);
});

stmts.cleanSession.run(nowISO());
server.listen(PORT, HOST, function () {
  const line = "─".repeat(52);
  console.log(line);
  console.log("  HCIA-AI Solution 题库刷题平台 已启动");
  console.log("  本机访问：http://" + HOST + ":" + PORT);
  console.log("  数据文件：" + path.join(DATA_DIR, "hcia.db"));
  console.log(line);
});
server.on("error", function (e) {
  if (e.code === "EADDRINUSE") {
    console.error("端口 " + PORT + " 已被占用，请先关闭占用程序，或用 PORT=xxxx node server.js 换端口。");
  } else {
    console.error(e);
  }
  process.exit(1);
});
// 优雅关闭：先归档 WAL 日志再关闭数据库，保证 data/hcia.db 为单文件完整备份。
// pm2 停止 / 系统信号均会触发。
function shutdown(signal) {
  console.log("\n收到 " + signal + "，正在归档数据库并关闭服务...");
  try { db.pragma("wal_checkpoint(TRUNCATE)"); } catch (e) { /* 忽略 */ }
  try { db.close(); } catch (e) { /* 忽略 */ }
  process.exit(0);
}
process.on("SIGINT", function () { shutdown("SIGINT"); });
process.on("SIGTERM", function () { shutdown("SIGTERM"); });
