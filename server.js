/**
 * 生产服务器：同时提供静态站点 + 本地 API 接口
 * 使用方式：node server.js [端口]
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { execSync } = require("child_process");
const express = require("express");
const bodyParser = require("body-parser");

const PORT = process.env.PORT ? parseInt(process.env.PORT) : parseInt(process.argv[2] || "3000");

// ---- 会话签名密钥：优先取环境变量，否则用随机值（重启后旧会话失效）----
const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_COOKIE = "si_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

// 生成签名的会话令牌（HMAC，含邮箱 + 过期时间，防伪造）
function createSessionToken(email) {
  const payload = `${email}|${Date.now() + SESSION_TTL_MS}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(payload + "|" + sig).toString("base64url");
}

// 校验会话令牌，成功返回 email，失败返回 null
function verifySessionToken(token) {
  if (!token) return null;
  let decoded;
  try {
    decoded = Buffer.from(token, "base64url").toString("utf-8");
  } catch (e) {
    return null;
  }
  const parts = decoded.split("|");
  if (parts.length !== 3) return null;
  const [email, expiry, sig] = parts;
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(`${email}|${expiry}`).digest("hex");
  // 恒定时间比较，防时序攻击
  const a = Buffer.from(String(sig));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expiry) < Date.now()) return null;
  return email;
}

// 从请求中解析会话：优先 HttpOnly Cookie，兼容 Authorization: Bearer
function getSessionEmail(req) {
  const cookie = parseCookies(req.headers.cookie || "");
  if (cookie[SESSION_COOKIE]) {
    const e = verifySessionToken(cookie[SESSION_COOKIE]);
    if (e) return e;
  }
  const auth = req.headers.authorization || "";
  if (auth.startsWith("Bearer ")) {
    const e = verifySessionToken(auth.slice(7).trim());
    if (e) return e;
  }
  return null;
}

function parseCookies(str) {
  const out = {};
  str.split(";").forEach((c) => {
    const idx = c.indexOf("=");
    if (idx > 0) out[c.slice(0, idx).trim()] = c.slice(idx + 1).trim();
  });
  return out;
}

// 认证中间件：校验会话，未通过返回 401
function requireAuth(req, res, next) {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).send("Error: 未登录或会话已过期");
  req.authEmail = email;
  next();
}

// 密码哈希（与历史兼容：注册/存储统一为 MD5(password:email)，验证时同样计算再比较）
function hashPassword(password, email) {
  return crypto.createHash("md5").update(String(password) + ":" + String(email)).digest("hex");
}
const BUILD_DIR = path.join(__dirname, "build");
const BLOG_DIR = path.join(__dirname, "blog");
const DATA_FILE = path.join(__dirname, "local-data", "users.json");

// ---- 本地数据读写（与 local-api.plugin.js 一致）----
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch (e) {
    return { registerCodes: ["siai"], users: {} };
  }
}

// 读取注册码列表（兼容旧的单码 registerCode 字段）
function getRegisterCodes(data) {
  if (Array.isArray(data.registerCodes) && data.registerCodes.length > 0) {
    return data.registerCodes;
  }
  // 迁移旧数据：将 registerCode 转为 registerCodes 数组
  if (data.registerCode) {
    data.registerCodes = [String(data.registerCode)];
    return data.registerCodes;
  }
  return [];
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}
function parseBody(body) {
  if (typeof body === "string") {
    try {
      return JSON.parse(body);
    } catch (e) {
      return {};
    }
  }
  return body || {};
}

const app = express();
// 限制请求体大小（1MB），防止内存耗尽型 DoS
app.use(bodyParser.text({ type: () => true, limit: "1mb" }));

// 基础安全响应头
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  next();
});

// ---------- 简单的内存速率限制（防暴力破解/刷接口）----------
const rateBuckets = {}; // ip -> { count, resetAt }
function rateLimit(opts) {
  const { windowMs = 60000, max = 60 } = opts || {};
  return (req, res, next) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const key = ip;
    const now = Date.now();
    const b = rateBuckets[key];
    if (!b || b.resetAt < now) {
      rateBuckets[key] = { count: 1, resetAt: now + windowMs };
      return next();
    }
    b.count += 1;
    if (b.count > max) {
      return res.status(429).send("Error: 请求过于频繁，请稍后再试");
    }
    next();
  };
}

// 登录/注册：更严格限速（同一 IP 每分钟最多 10 次）
app.post("/api/LoginHandler", rateLimit({ windowMs: 60000, max: 10 }));
app.post("/api/RegisterHandler", rateLimit({ windowMs: 60000, max: 10 }));

// ==== 注册 ====
app.post("/api/RegisterHandler", (req, res) => {
  const body = parseBody(req.body);
  const data = loadData();
  if (!getRegisterCodes(data).includes(String(body.code || ""))) {
    return res.status(400).send("Error: wrong code.");
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!body.email || !body.password) return res.status(400).send("Error: no request body.");
  // 防止原型污染：拒绝 __proto__/prototype/constructor 键名
  if (email === "__proto__" || email === "prototype" || email === "constructor") {
    return res.status(400).send("Error: invalid email.");
  }
  if (data.users[email]) return res.status(400).send("Error: 该邮箱已注册");
  data.users[email] = hashPassword(body.password, email);
  saveData(data);
  // 设置会话，注册后自动登录
  res.cookie(SESSION_COOKIE, createSessionToken(email), {
    httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: SESSION_TTL_MS,
  });
  return res.send("Success");
});

// ==== 注册码管理（需登录）====
app.all("/api/CodeHandler", requireAuth, (req, res) => {
  const data = loadData();
  getRegisterCodes(data); // 确保 registerCodes 已初始化
  if (!Array.isArray(data.registerCodes)) data.registerCodes = [];

  const lower = (s) => String(s).toLowerCase().trim();

  if (req.method === "GET") {
    return res.json({ codes: data.registerCodes });
  } else if (req.method === "POST") {
    const body = parseBody(req.body) || {};
    let input = [];
    if (typeof body.codes === "string") {
      input = body.codes.split(/[\n,，\s]+/).map((s) => String(s).trim()).filter(Boolean);
    } else if (Array.isArray(body.codes)) {
      input = body.codes.map((s) => String(s).trim()).filter(Boolean);
    }
    if (input.length === 0) return res.status(400).json({ msg: "Error: no codes." });
    let added = 0;
    let skipped = 0;
    for (const raw of input) {
      if (data.registerCodes.some((c) => lower(c) === lower(raw))) {
        skipped++;
        continue;
      }
      data.registerCodes.push(raw);
      added++;
    }
    saveData(data);
    return res.json({ msg: "Success", added, skipped, total: data.registerCodes.length });
  } else if (req.method === "DELETE") {
    const body = parseBody(req.body) || {};
    let input = [];
    if (typeof body.codes === "string") {
      input = body.codes.split(/[\n,，]/).map((s) => String(s).trim()).filter(Boolean);
    } else if (Array.isArray(body.codes)) {
      input = body.codes.map((s) => String(s).trim()).filter(Boolean);
    }
    if (input.length === 0) return res.status(400).json({ msg: "Error: no codes." });
    const targets = input.map(lower);
    const before = data.registerCodes.length;
    data.registerCodes = data.registerCodes.filter((c) => !targets.includes(lower(c)));
    saveData(data);
    return res.json({ msg: "Success", removed: before - data.registerCodes.length, total: data.registerCodes.length });
  }
  return res.status(400).json({ msg: "Error: unknown error" });
});

// ==== 登录 ====
app.post("/api/LoginHandler", (req, res) => {
  const body = parseBody(req.body);
  if (!body || !body.email || !body.password) return res.status(400).send("Error: no request body.");
  const data = loadData();
  const email = String(body.email).trim().toLowerCase();
  const stored = data.users[email];
  if (!stored) return res.status(401).send("Error: 账号或密码错误");
  // 服务端校验密码，不再返回存储的哈希
  const ok = hashPassword(body.password, email) === stored;
  if (!ok) return res.status(401).send("Error: 账号或密码错误");
  res.cookie(SESSION_COOKIE, createSessionToken(email), {
    httpOnly: true, sameSite: "lax", secure: false, path: "/", maxAge: SESSION_TTL_MS,
  });
  return res.send("Success");
});

// ==== 登出 ====
app.post("/api/LogoutHandler", (req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  return res.send("Success");
});

// ==== 当前会话 ====
app.get("/api/SessionHandler", (req, res) => {
  const email = getSessionEmail(req);
  return res.json({ loggedIn: !!email, email: email || null });
});

// ==== 报名 ====
app.all("/api/SignUpHandler", (req, res) => {
  const data = loadData();
  if (req.method === "POST") {
    const body = parseBody(req.body);
    if (!body || body.timestamp === undefined || !body.data) return res.status(400).send("Error: no request body.");
    data.partList[String(body.timestamp)] = body.data;
    saveData(data);
    return res.send("Success");
  } else if (req.method === "GET") { // 报名列表：需登录
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    return res.json(data.partList || {});
  } else if (req.method === "DELETE") { // 删除报名：需登录
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    const body = parseBody(req.body);
    if (body.timestamp && data.partList[String(body.timestamp)]) {
      delete data.partList[String(body.timestamp)];
      saveData(data);
      return res.send("Success");
    }
    return res.status(400).send("Error: not found");
  }
  return res.status(400).send("Error: unknown error");
});

// ==== 报名配置 ====
app.all("/api/SignUpConfigHandler", (req, res) => {
  const data = loadData();
  if (req.method === "GET") {
    return res.json({
      start: (data.signupTime && data.signupTime.start) || "",
      end: (data.signupTime && data.signupTime.end) || "",
      submitRedirectUrl: data.submitRedirectUrl || "",
    });
  } else if (req.method === "POST") { // 报名时间/跳转链接：需登录
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    const body = parseBody(req.body);
    const cur = data.signupTime || { start: "", end: "" };
    if (body.start !== undefined) cur.start = body.start || "";
    if (body.end !== undefined) cur.end = body.end || "";
    data.signupTime = cur;
    if (body.submitRedirectUrl !== undefined) data.submitRedirectUrl = String(body.submitRedirectUrl) || "";
    saveData(data);
    return res.send("Success");
  }
  return res.status(400).send("Error: unknown error");
});

// ==== 社团人数 ====
app.all("/api/MemberConfigHandler", requireAuth, (req, res) => {
  const data = loadData();
  if (req.method === "GET") {
    return res.json(data.memberCount || { newbie: 0, management: 0 });
  } else if (req.method === "POST") {
    const body = parseBody(req.body);
    data.memberCount = {
      newbie: Number.isFinite(Number(body.newbie)) ? Number(body.newbie) : 0,
      management: Number.isFinite(Number(body.management)) ? Number(body.management) : 0,
    };
    saveData(data);
    return res.send("Success");
  }
  return res.status(400).send("Error: unknown error");
});

// ==== 人员名单（需登录）====
function ensureMembers(data) {
  if (!Array.isArray(data.members)) data.members = [];
  return data.members;
}
function membersToJSON(list) {
  return list.map((m) => ({
    name: String((m && m.name) || ""),
    position: String((m && m.position) || ""),
    addedAt: Number((m && m.addedAt) || 0),
  }));
}
app.all("/api/MemberListHandler", requireAuth, (req, res) => {
  const data = loadData();
  const list = ensureMembers(data);
  if (req.method === "GET") {
    return res.json(membersToJSON(list));
  } else if (req.method === "POST") {
    const body = parseBody(req.body) || {};
    // 批量新增：body.names 逗号/换行分隔 或 数组；可带 body.position 作为默认职位
    let names = [];
    if (typeof body.names === "string") {
      names = body.names
        .split(/[\n,，]+/)
        .map((s) => String(s).trim())
        .filter(Boolean);
    } else if (Array.isArray(body.names)) {
      names = body.names.map((s) => String(s && s.name !== undefined ? s.name : s).trim()).filter(Boolean);
    }
    if (names.length === 0) return res.status(400).send("Error: 名单为空");
    const defaultPosition = String((body.position || "").trim());
    const lower = (n) => String(n).toLowerCase();
    let added = 0;
    let skipped = 0;
    for (const n of names) {
      if (list.some((m) => lower(m.name) === lower(n))) {
        skipped++;
        continue;
      }
      list.push({ name: n, position: defaultPosition, addedAt: Date.now() });
      added++;
    }
    saveData(data);
    return res.json({ msg: "Success", added, skipped, total: list.length });
  } else if (req.method === "DELETE") {
    const body = parseBody(req.body) || {};
    let targets = [];
    if (typeof body.names === "string") {
      targets = body.names
        .split(/[\n,，]+/)
        .map((s) => String(s).trim())
        .filter(Boolean);
    } else if (Array.isArray(body.names)) {
      targets = body.names.map((s) => String(s)).filter(Boolean);
    } else if (body.name) {
      targets = [String(body.name).trim()];
    }
    if (targets.length === 0) return res.status(400).send("Error: 参数错误");
    const lower = (n) => String(n).toLowerCase();
    const lowerTargets = targets.map(lower);
    const before = list.length;
    data.members = list.filter((m) => !lowerTargets.includes(lower(m.name)));
    saveData(data);
    return res.json({ msg: "Success", removed: before - data.members.length, total: data.members.length });
  }
  return res.status(400).send("Error: unknown error");
});

// ==== 抽奖 ====
app.all("/api/DrawHandler", (req, res) => {
  const data = loadData();
  if (!data.draw) data.draw = { config: [], active: false, participants: [], results: [], history: [] };
  const draw = data.draw;
  if (!Array.isArray(draw.config)) draw.config = [];
  if (!Array.isArray(draw.participants)) draw.participants = [];
  if (!Array.isArray(draw.results)) draw.results = [];
  if (!Array.isArray(draw.history)) draw.history = []; // 中奖公示历史

  if (req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    if (url.searchParams.get("get") === "state") {
      return res.json({
        active: draw.active,
        config: draw.config,
        participants: draw.participants,
        results: draw.results,
        history: draw.history, // 历史中奖公示
      });
    }
    return res.status(400).json({ msg: "Error: unknown type" });
  }

  if (req.method !== "POST") {
    return res.status(400).json({ msg: "Error: unknown error" });
  }

  const body = parseBody(req.body);

  // 参与抽奖
  if (body.participate === true && body.name) {
    if (!draw.active) return res.status(400).send("Error: 抽奖未开放");
    const name = String(body.name).trim();
    const members = ensureMembers(data);
    const lower = (n) => String(n).toLowerCase();
    // 校验在人员名单内
    if (!members.some((m) => lower(m.name) === lower(name))) {
      return res.status(400).send("Error: 您不在人员名单中，无法参与");
    }
    // 不能重复抽（本轮已参与过则拒绝）
    if (draw.participants.some((n) => lower(n) === lower(name))) {
      return res.status(400).send("Error: 您本轮已参与过，不能重复参与");
    }
    draw.participants.push(name);
    saveData(data);
    return res.send("Success");
  }

  // 开放/关闭参与（管理）
  if (body.setActive !== undefined) {
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    draw.active = body.setActive === true;
    saveData(data);
    return res.send("Success");
  }

  // 保存奖项配置（管理）
  if (body.saveConfig !== undefined) {
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    if (!Array.isArray(body.saveConfig)) return res.status(400).send("Error: 参数错误");
    draw.config = body.saveConfig
      .map((p) => ({
        name: String((p && p.name) || "").trim(),
        count: Math.max(1, Math.floor(Number((p && p.count) || 0))),
      }))
      .filter((p) => p.name);
    saveData(data);
    return res.send("Success");
  }

  // 清空参与者（管理）
  if (body.clearParticipants === true) {
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    draw.participants = [];
    saveData(data);
    return res.send("Success");
  }

  // 执行抽奖（管理）
  if (body.execDraw === true) {
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    const total = draw.config.reduce((s, p) => s + (p.count || 0), 0);
    if (total <= 0) return res.status(400).send("Error: 未配置奖项");
    if (draw.participants.length === 0) return res.status(400).send("Error: 暂无可参与抽奖的人");
    const pool = [...draw.participants];
    // 洗牌（Fisher-Yates）
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const results = [];
    let idx = 0;
    for (const prize of draw.config) {
      const winners = [];
      for (let k = 0; k < prize.count && idx < pool.length; k++) {
        winners.push(pool[idx]);
        idx++;
      }
      results.push({ prize: prize.name, winners });
    }
    draw.results = results;
    // 追加到中奖公示历史（带时间戳）
    if (!Array.isArray(draw.history)) draw.history = [];
    draw.history.push({
      time: Date.now(),
      results: results,
    });
    saveData(data);
    return res.json({ msg: "Success", results });
  }

  // 重置整轮（管理）
  if (body.reset === true) {
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    draw.participants = [];
    draw.results = [];
    saveData(data);
    return res.send("Success");
  }

  // 清空中奖公示历史（管理）
  if (body.clearHistory === true) {
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    draw.history = [];
    saveData(data);
    return res.send("Success");
  }

  // 删除某一轮历史公示（管理）：body.deleteHistory 传该轮的 time 或 index
  if (body.deleteHistory !== undefined) {
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    if (!Array.isArray(draw.history)) draw.history = [];
    const target = body.deleteHistory;
    const idx = typeof target === "number" && target < draw.history.length ? target : draw.history.findIndex((h) => h.time === Number(target));
    if (idx < 0) return res.status(400).send("Error: 未找到该轮公示");
    draw.history.splice(idx, 1);
    saveData(data);
    return res.send("Success");
  }

  // 编辑某一轮历史公示（管理）：body.updateHistory 传 index（或 time）+ 新的 results
  if (body.updateHistory !== undefined) {
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    if (!Array.isArray(draw.history)) draw.history = [];
    const index = body.updateHistory;
    const idx = typeof index === "number" && index < draw.history.length ? index : -1;
    if (idx < 0) return res.status(400).send("Error: 未找到该轮公示");
    if (!Array.isArray(body.results)) return res.status(400).send("Error: 参数错误");
    const toWinners = (w) =>
      Array.isArray(w)
        ? w.map((x) => String(x).trim()).filter(Boolean)
        : String(w || "").split(/[、,，]+/).map((s) => s.trim()).filter(Boolean);
    const newResults = body.results
      .map((r) => ({
        prize: String((r && r.prize) || "").trim(),
        winners: toWinners(r && r.winners),
      }))
      .filter((r) => r.prize);
    draw.history[idx].results = newResults;
    saveData(data);
    return res.send("Success");
  }

  return res.status(400).json({ msg: "Error: unknown error" });
});

// ==== 直播链接（需登录）====
app.all("/api/LiveConfigHandler", requireAuth, (req, res) => {
  const data = loadData();
  if (req.method === "GET") {
    return res.json({ url: data.liveUrl || "" });
  } else if (req.method === "POST") {
    const body = parseBody(req.body);
    data.liveUrl = body.url || "";
    saveData(data);
    return res.send("Success");
  }
  return res.status(400).send("Error: unknown error");
});

// ==== 签到 ====
app.all("/api/SigninHandler", (req, res) => {
  const data = loadData();
  if (!data.signin) data.signin = { active: false, activeEvent: "", subtitle: "", records: {} };
  const ensureEvent = () => {
    if (data.signin.activeEvent && !data.signin.records[data.signin.activeEvent]) {
      data.signin.records[data.signin.activeEvent] = [];
    }
  };
  if (req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const get = url.searchParams.get("get");
    if (get === "active") {
      ensureEvent();
      return res.json({
        active: data.signin.active,
        event: data.signin.activeEvent,
        subtitle: data.signin.subtitle || "",
        records: data.signin.active ? data.signin.records[data.signin.activeEvent] || [] : [],
      });
    }
    if (get === "records") { // 查看某轮签到记录：需登录
      if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
      const event = url.searchParams.get("event");
      return res.json(data.signin.records[event] || []);
    }
    if (get === "events") { // 历史事件列表：需登录
      if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
      const events = Object.keys(data.signin.records || {}).map((ev) => ({
        event: ev,
        time: Number(ev),
        count: (data.signin.records[ev] || []).length,
      }));
      events.sort((a, b) => b.time - a.time);
      return res.json(events);
    }
    return res.status(400).json({ msg: "Error: unknown type" });
  } else if (req.method === "POST") {
    const body = parseBody(req.body);
    // 以下为管理操作：需登录
    if (body.setSubtitle !== undefined || body.publish !== undefined) {
      if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    }
    if (body.setSubtitle !== undefined) {
      data.signin.subtitle = String(body.setSubtitle);
      saveData(data);
      return res.send("Success");
    }
    if (body.publish === true) {
      const event = String(Date.now());
      data.signin.active = true;
      data.signin.activeEvent = event;
      if (!data.signin.records[event]) data.signin.records[event] = [];
      saveData(data);
      return res.json({ msg: "Success", event: event });
    }
    if (body.publish === false) {
      data.signin.active = false;
      saveData(data);
      return res.send("Success");
    }
    if (body.name && body.event) {
      if (!data.signin.active || data.signin.activeEvent !== body.event) return res.status(400).send("Error: 签到未开启");
      const list = data.signin.records[body.event] || [];
      // 校验名字是否在人员名单内
      const members = ensureMembers(data);
      const lower = (n) => String(n).toLowerCase();
      const isMember = members.some((m) => lower(m.name) === lower(String(body.name)));
      if (!isMember) return res.status(400).send("Error: 您不在人员名单中，无法签到");
      const exists = list.some((r) => r.name === body.name);
      if (exists) return res.status(400).send("Error: 已签到");
      list.push({ name: body.name, time: Date.now() });
      data.signin.records[body.event] = list;
      saveData(data);
      return res.send("Success");
    }
    return res.status(400).send("Error: 参数错误");
  }
  return res.status(400).send("Error: unknown error");
});

// ==== 投票 ====
app.all("/api/VoteHandler", (req, res) => {
  const data = loadData();
  if (!data.votes) data.votes = { datas: {}, records: [] };
  if (req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const type = url.searchParams.get("type");
    if (type === "get") return res.json(data.votes.datas || {});
    if (type === "calc") {
      const stat = {};
      (data.votes.records || []).forEach((rec) => {
        const id = rec.id;
        const items = rec.items || [];
        if (!stat[id]) stat[id] = {};
        items.forEach((item) => {
          if (!stat[id][item]) stat[id][item] = 0;
          stat[id][item] += 1;
        });
      });
      return res.json(stat);
    }
    return res.status(400).send("Error: unknown type");
  } else if (req.method === "POST") {
    const body = parseBody(req.body);
    if (body && typeof body === "object") {
      if (body._saveDatas !== undefined) { // 管理保存投票配置：需登录
        if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
        data.votes.datas = body._saveDatas || {};
        if (body._clearRecords === true) data.votes.records = [];
        saveData(data);
        return res.send("Success");
      }
      if (!data.votes.records) data.votes.records = [];
      for (const id of Object.keys(body)) {
        data.votes.records.push({ id: id, items: Array.isArray(body[id]) ? body[id] : [], time: Date.now() });
      }
      saveData(data);
      return res.send("Success");
    }
    return res.status(400).send("Error: 参数错误");
  }
  return res.status(400).send("Error: unknown error");
});

// ==== Q&A ====
app.all("/api/QAHandler", (req, res) => {
  const data = loadData();
  if (!data.qa) data.qa = {};
  if (req.method === "POST") {
    const body = parseBody(req.body);
    if (!body || typeof body !== "object") return res.status(400).send("Error: no request body.");
    // 公开提交问题（{ timestamp, data }）
    if (body.timestamp) {
      data.qa[String(body.timestamp)] = body.data || { question: "", answer: "" };
      saveData(data);
      return res.send("Success");
    }
    // 删除问题/答案：需登录
    if (body.delete !== undefined) {
      if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
      delete data.qa[String(body.delete)];
      saveData(data);
      return res.send("Success");
    }
    return res.status(400).send("Error: unknown error");
  } else if (req.method === "GET") {
    return res.json(data.qa);
  }
  return res.status(400).send("Error: unknown error");
});

// ==== 数据(经费) ====
app.post("/api/DataHandler", (req, res) => {
  const data = loadData();
  const body = parseBody(req.body);
  if (!body || typeof body !== "object") return res.status(400).json({ msg: "Error: no request body" });
  if (body.get) {
    if (body.get === "economy") return res.json({ economy: data.economy || [] }); // 公开只读
    if (body.get === "user") { // 用户数据：需登录
      if (!getSessionEmail(req)) return res.status(401).json({ msg: "Error: 未登录或会话已过期" });
      return res.json(data.users[body.email] || null);
    }
  }
  // 写经费：需登录
  if (body.__economy && body.__economy.economy) {
    if (!getSessionEmail(req)) return res.status(401).json({ msg: "Error: 未登录或会话已过期" });
    data.economy = body.__economy.economy;
    saveData(data);
    return res.json({ msg: "Success" });
  }
  return res.status(400).json({ msg: "Error: unknown error" });
});

// ==== 博客（需登录）====
app.all("/api/BlogHandler", requireAuth, (req, res) => {
  if (req.method === "GET") {
    const url = new URL(req.url, "http://localhost");
    const get = url.searchParams.get("get");
    if (get === "list") {
      // 列出所有博客
      let files = [];
      try {
        files = fs.readdirSync(BLOG_DIR).filter((f) => f.endsWith(".md"));
      } catch (e) {}
      const blogs = files
        .map((f) => {
          const raw = fs.readFileSync(path.join(BLOG_DIR, f), "utf-8");
          const titleMatch = raw.match(/^title:\s*(.+)$/m);
          const slugMatch = raw.match(/^slug:\s*(.+)$/m);
          return {
            file: f,
            title: titleMatch ? titleMatch[1].trim() : f.replace(/\.md$/, ""),
            slug: slugMatch ? slugMatch[1].trim() : "",
          };
        })
        .sort((a, b) => b.file.localeCompare(a.file));
      return res.json(blogs);
    }
    if (get === "one") {
      const file = url.searchParams.get("file");
      if (!file) return res.status(400).send("Error: 缺少文件名");
      const fp = path.join(BLOG_DIR, path.basename(file));
      if (!fs.existsSync(fp)) return res.status(404).send("Error: 博客不存在");
      return res.send(fs.readFileSync(fp, "utf-8"));
    }
    return res.status(400).send("Error: unknown type");
  } else if (req.method === "POST") {
    const body = parseBody(req.body);

    // 删除博客
    if (body.delete) {
      const fp = path.join(BLOG_DIR, path.basename(body.delete));
      if (fs.existsSync(fp)) {
        fs.unlinkSync(fp);
        return res.send("Success");
      }
      return res.status(404).send("Error: 博客不存在");
    }

    // 保存博客：{ title, slug, author, content, file? }
    if (body.title && body.content) {
      const date = new Date();
      const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const slug = (body.slug || "").trim().replace(/\\s+/g, "-") || dateStr;
      // 更新时用已有文件名，新建时用 日期+slug 命名
      const fileName =
        body.file && /^[a-zA-Z0-9._-]+\\.md$/.test(body.file)
          ? body.file
          : `${dateStr}-${slug}.md`;
      const fp = path.join(BLOG_DIR, path.basename(fileName));
      const fmLines = [
        "---",
        `slug: ${slug}`,
        `title: ${body.title.trim()}`,
        "authors:",
        `  - name: ${(body.author || "匿名").trim()}`,
      ];
      const avatar = (body.avatar || "").trim();
      if (avatar) {
        fmLines.push(`    image_url: ${avatar}`);
      }
      fmLines.push("---", "", body.content, "", "<!-- truncate -->", "");
      const fm = fmLines.join("\n");
      fs.writeFileSync(fp, fm, "utf-8");
      return res.json({ msg: "Success", file: fileName });
    }

    // 重建站点
    if (body.rebuild === true) {
      try {
        execSync("npm run build", { cwd: __dirname, stdio: "pipe", timeout: 120000 });
        return res.send("Success");
      } catch (e) {
        return res.status(500).send("Error: 构建失败 " + e.message);
      }
    }
    return res.status(400).send("Error: 参数错误");
  }
  return res.status(400).send("Error: unknown error");
});

// ==== 静态文件服务（生产构建 build/）====
app.use(express.static(BUILD_DIR));

// SPA/多页回退：未命中的路径返回 index.html（处理直接访问深层路由）
app.use((req, res, next) => {
  if (req.method !== "GET") return next();
  res.sendFile(path.join(BUILD_DIR, "index.html"));
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[生产服务器] 运行于 http://0.0.0.0:${PORT} （静态目录: ${BUILD_DIR}）`);
});
