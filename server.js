/**
 * 生产服务器：同时提供静态站点 + 本地 API 接口
 * 使用方式：node server.js [端口]
 */
const path = require("path");
const fs = require("fs");
const net = require("net");
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

// 匿名投票者标识（仅用于服务端防重复投票，与登录身份无关）
// 安全设计：**不再采信客户端自报的 si_voter Cookie**。
// 旧实现把客户端提交的 Cookie 值当作身份，攻击者只要换一个随机值就能重复投票。
// 现改为服务端基于「来源 IP + User-Agent」派生（HMAC），客户端无法自称新身份。
const VOTER_COOKIE = "si_voter";
function voterId(req) {
  const ua = String(req.headers["user-agent"] || "").slice(0, 300);
  return crypto
    .createHmac("sha256", SESSION_SECRET)
    .update("voter:" + clientIp(req) + "|" + ua)
    .digest("hex")
    .slice(0, 32);
}

// 认证中间件：校验会话，未通过返回 401
function requireAuth(req, res, next) {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).send("Error: 未登录或会话已过期");
  req.authEmail = email;
  next();
}

// ---------- 用户角色系统（普通 user / 管理员 admin / 超级管理员 super）----------
// 角色权重：user=0 < admin=10 < super=20
const ROLES = { user: 0, admin: 10, super: 20 };
const ROLE_NAMES = { user: "普通用户", admin: "管理员", super: "超级管理员" };

// 单个用户记录规范化：兼容旧的 纯哈希字符串 格式，迁移为 { hash, role, nick, active, createdAt }
function normalizeUser(email, val) {
  const lower = String(email).trim().toLowerCase();
  if (val && typeof val === "object" && typeof val.hash === "string") {
    return {
      hash: val.hash,
      role: ROLES[val.role] !== undefined ? String(val.role) : "user",
      nick: String(val.nick || "").trim() || lower.split("@")[0] || "",
      active: val.active === undefined ? true : !!val.active,
      createdAt: Number(val.createdAt) || Date.now(),
    };
  }
  // 旧格式：值是密码哈希字符串
  return {
    hash: typeof val === "string" ? val : "",
    role: "user",
    nick: lower.split("@")[0] || "",
    active: true,
    createdAt: Date.now(),
  };
}

// 返回用户展示字段（不含哈希）
function userToJSON(email, u) {
  return {
    email: String(email).trim().toLowerCase(),
    role: u.role || "user",
    roleName: ROLE_NAMES[u.role] || "普通用户",
    nick: String(u.nick || ""),
    active: u.active === undefined ? true : !!u.active,
    createdAt: Number(u.createdAt) || 0,
  };
}

// 触发一次全量用户数据迁移（把旧字符串格式升级为对象格式）
function migrateUsers(data) {
  if (!data.users || typeof data.users !== "object") data.users = {};
  let changed = false;
  for (const email of Object.keys(data.users)) {
    const old = data.users[email];
    if (old && typeof old === "object" && typeof old.hash === "string") continue;
    data.users[email] = normalizeUser(email, old);
    changed = true;
  }
  if (changed) saveData(data);
  return data.users;
}

function getRole(data, email) {
  if (!email) return "user";
  const u = data.users[String(email).trim().toLowerCase()];
  if (!u) return "user";
  return ROLES[u.role] !== undefined ? String(u.role) : "user";
}

// 角色权限是否满足最低要求：minRole 可为 "user"/"admin"/"super"
function roleAtLeast(role, minRole) {
  return (ROLES[role] || 0) >= (ROLES[minRole] || 0);
}

// 当前请求用户角色
function getReqRole(req) {
  const data = loadData();
  return { email: getSessionEmail(req) || req.authEmail || null, data };
}

// 角色校验中间件：仅登录 + 至少 minRole
function requireRole(minRole) {
  return (req, res, next) => {
    const email = getSessionEmail(req);
    if (!email) return res.status(401).send("Error: 未登录或会话已过期");
    const data = loadData();
    const role = getRole(data, email);
    if (!roleAtLeast(role, minRole)) {
      return res.status(403).send("Error: 权限不足（需 " + ROLE_NAMES[minRole] + "）");
    }
    req.authEmail = email;
    req.authRole = role;
    next();
  };
}

// 便捷：请求中的邮箱是否为指定角色
function reqRoleAtLeast(req, minRole) {
  if (req.authRole) return roleAtLeast(String(req.authRole), minRole);
  const email = getSessionEmail(req);
  if (!email) return false;
  const data = loadData();
  return roleAtLeast(getRole(data, email), minRole);
}

// 密码哈希（与历史兼容：注册/存储统一为 MD5(password:email)，验证时同样计算再比较）
function hashPassword(password, email) {
  return crypto.createHash("md5").update(String(password) + ":" + String(email)).digest("hex");
}
const BUILD_DIR = path.join(__dirname, "build");
const BLOG_DIR = path.join(__dirname, "blog");
const DATA_FILE = path.join(__dirname, "local-data", "users.json");
const GALLERY_DIR = path.join(__dirname, "local-data", "gallery");
// 初始超级管理员邮箱（首个超管，可在用户管理中调整）
const SUPER_ADMIN_EMAIL = "zzr_siai@163.com";

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
// 隐藏技术栈信息（X-Powered-By: Express）
app.disable("x-powered-by");
// 路由大小写敏感：`/api/QaHandler` 这类大小写变体不再命中真实接口，避免鉴权/白名单歧义
app.set("case sensitive routing", true);
// 社团风采上传：允许更大的请求体（base64 图片，最大约 15MB → 20MB limit）
app.use("/api/GalleryHandler", bodyParser.text({ type: () => true, limit: "20mb" }));
// 限制请求体大小（1MB），防止内存耗尽型 DoS
app.use(bodyParser.text({ type: () => true, limit: "1mb" }));

// ---------- 反向代理信任边界 ----------
// 站点只监听回环地址，唯一可达来源是本机 cloudflared。
// 因此仅当连接来自回环地址时才采用 CF-Connecting-IP / X-Forwarded-For，
// 防止外部伪造转发头绕过限速、污染日志。
const TRUSTED_PROXY_ADDRS = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);
function isTrustedProxy(req) {
  const ra = String(req.socket.remoteAddress || "");
  return TRUSTED_PROXY_ADDRS.has(ra) || ra.startsWith("::ffff:127.");
}
// 头部来源 IP 必须是合法 IP 字面量，否则忽略
// （防止有人用任意字符串当限速键，制造海量桶或绕过限速）
function isValidIpString(s) {
  if (typeof s !== "string") return false;
  const v = s.trim();
  if (!v || v.length > 45) return false;
  if (net.isIPv4(v) || net.isIPv6(v)) return true;
  return false;
}
function clientIp(req) {
  if (isTrustedProxy(req)) {
    const cf = req.headers["cf-connecting-ip"];
    if (cf) {
      const v = String(cf).split(",")[0].trim();
      if (isValidIpString(v)) return v;
      // 非法值不再直接采信，直接落到最细粒度的兜底键
      return "invalid-cf-header";
    }
    const xff = req.headers["x-forwarded-for"];
    if (xff) {
      const v = String(xff).split(",")[0].trim();
      if (isValidIpString(v)) return v;
      return "invalid-xff-header";
    }
  }
  return String(req.socket.remoteAddress || "unknown");
}
// 是否经 HTTPS 回源（cloudflared 注入 x-forwarded-proto）
function isHttps(req) {
  return req.headers["x-forwarded-proto"] === "https" || req.secure === true;
}
// Cookie 安全属性：仅 HTTPS 时带 Secure（本地 http 调试不受影响）
function cookieSecure(req) {
  return isHttps(req);
}

// 基础安全响应头
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=(), payment=()");
  // HSTS：仅在 HTTPS 回源时下发
  if (isHttps(req)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  // CSP：仅允许同源资源（Docusaurus 需要 inline script/style）
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data:",
      "media-src 'self' blob: data: https: http:",
      "connect-src 'self' https://cloudflareinsights.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; ")
  );
  next();
});

// ---------- CSRF 防护：状态变更请求校验 Origin ----------
// 浏览器跨站 POST 必带 Origin；同站请求 Origin 与 Host 一致。
// 另配合 SameSite=Lax Cookie，纵深防御。
const EXTRA_ALLOWED_ORIGINS = new Set([
  "chunbosama.xyz",
  "ai.chunbosama.xyz",
  "localhost:3000",
  "localhost:4000",
  "127.0.0.1:3000",
  "127.0.0.1:4000",
]);
app.use((req, res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.headers.origin;
  if (origin) {
    let host = "";
    try {
      host = new URL(origin).host;
    } catch (e) {
      host = "";
    }
    const sameHost = host && host === String(req.headers.host || "");
    if (!sameHost && !EXTRA_ALLOWED_ORIGINS.has(host)) {
      return res.status(403).send("Error: 非法请求来源");
    }
  }
  next();
});

// ---------- 简单的内存速率限制（防暴力破解/刷接口）----------
const rateBuckets = {}; // key -> { count, resetAt }
// 通用限速判定：返回 true=放行 / false=超限
function allowRate(key, windowMs, max) {
  const now = Date.now();
  const b = rateBuckets[key];
  if (!b || b.resetAt < now) {
    // 防内存无限增长：桶过多时清理已过期项
    if (Object.keys(rateBuckets).length > 5000) {
      for (const k of Object.keys(rateBuckets)) {
        if (rateBuckets[k].resetAt < now) delete rateBuckets[k];
      }
    }
    rateBuckets[key] = { count: 1, resetAt: now + windowMs };
    return true;
  }
  b.count += 1;
  return b.count <= max;
}
// 统一的限速超限响应：保持 JSON 风格 + 告知客户端何时可重试
function tooManyRequests(res, windowMs) {
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(windowMs / 1000))));
  return res
    .status(429)
    .type("json")
    .send(JSON.stringify({ msg: "Error: 请求过于频繁，请稍后再试" }));
}
// 双闸限速：① 每来源 IP ② 全局兜底
// 全局闸的意义：即使来源 IP 被伪造（例如本机进程伪造 CF-Connecting-IP），
// 攻击者也无法突破「单位时间总请求量」上限。
function rateLimit(opts) {
  const { windowMs = 60000, max = 60, name = "generic", globalMax = 0 } = opts || {};
  return (req, res, next) => {
    if (globalMax > 0 && !allowRate("global:" + name, windowMs, globalMax)) {
      return tooManyRequests(res, windowMs);
    }
    // 仅采信回环代理注入的真实客户端 IP；外部伪造 XFF 无效
    if (!allowRate(name + ":" + clientIp(req), windowMs, max)) {
      return tooManyRequests(res, windowMs);
    }
    next();
  };
}

// 登录/注册：更严格限速（同一 IP 每分钟最多 10 次）
// 注意：两者使用独立命名空间，避免互相挤占额度（原先共用同一个桶）
app.post("/api/LoginHandler", rateLimit({ windowMs: 60000, max: 10, name: "login", globalMax: 200 }));
app.post("/api/RegisterHandler", rateLimit({ windowMs: 60000, max: 10, name: "register", globalMax: 120 }));

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
  migrateUsers(data); // 确保已有用户迁移为对象格式
  data.users[email] = {
    hash: hashPassword(body.password, email),
    role: "user",
    nick: email.split("@")[0] || "",
    active: true,
    createdAt: Date.now(),
  };
  saveData(data);
  // 设置会话，注册后自动登录
  res.cookie(SESSION_COOKIE, createSessionToken(email), {
    httpOnly: true, sameSite: "lax", secure: cookieSecure(req), path: "/", maxAge: SESSION_TTL_MS,
  });
  return res.send("Success");
});

// ==== 注册码管理（列表需登录，增删需管理员）====
app.all("/api/CodeHandler", (req, res) => {
  const data = loadData();
  getRegisterCodes(data); // 确保 registerCodes 已初始化
  if (!Array.isArray(data.registerCodes)) data.registerCodes = [];

  const lower = (s) => String(s).toLowerCase().trim();

  if (req.method === "GET") {
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    return res.json({ codes: data.registerCodes });
  } else if (req.method === "POST") { // 新增注册码：需管理员
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
  } else if (req.method === "DELETE") { // 删除注册码：需管理员
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
  // 登录前迁移该用户（兼容旧字符串哈希格式）
  if (data.users[email] && typeof data.users[email] !== "object") {
    data.users[email] = normalizeUser(email, data.users[email]);
    saveData(data);
  }
  const stored = data.users[email];
  if (!stored) return res.status(401).send("Error: 账号或密码错误");
  // 停用账号禁止登录
  if (stored.active === false) return res.status(401).send("Error: 账号已被停用");
  // 服务端校验密码，不再返回存储的哈希
  const ok = (typeof stored === "object" ? stored.hash : stored) === hashPassword(body.password, email);
  if (!ok) return res.status(401).send("Error: 账号或密码错误");
  res.cookie(SESSION_COOKIE, createSessionToken(email), {
    httpOnly: true, sameSite: "lax", secure: cookieSecure(req), path: "/", maxAge: SESSION_TTL_MS,
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
  if (!email) return res.json({ loggedIn: false, email: null, role: null });
  const data = loadData();
  const role = getRole(data, email);
  return res.json({ loggedIn: true, email, role });
});

// ==== 报名 ====
const SIGNUP_MAX_TOTAL = 2000;
// 报名资料格式校验
function isValidEmailAddr(s) {
  return typeof s === "string" && s.length <= 60 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}
function isValidPhoneNo(s) {
  return typeof s === "string" && /^1[3-9]\d{9}$/.test(s);
}
// 报名窗口是否开启（服务端强制校验；前端禁用表单只是障眼法）
function signupWindowState(data) {
  const win = data.signupTime || {};
  const now = Date.now();
  const start = win.start ? Date.parse(win.start) : NaN;
  const end = win.end ? Date.parse(win.end) : NaN;
  if (!Number.isFinite(start) && !Number.isFinite(end)) return { ok: true };
  if (Number.isFinite(start) && now < start) return { ok: false, msg: "报名尚未开始" };
  if (Number.isFinite(end) && now > end) return { ok: false, msg: "报名已截止" };
  return { ok: true };
}

// ==== 报名提交 ====
app.all("/api/SignUpHandler", (req, res) => {
  const data = loadData();
  if (req.method === "POST") {
    // 限速：单 IP 每分钟 5 次 + 全局兜底（旧实现无任何限速，可无限灌水）
    if (!allowRate("signup:global", 60000, 60)) return tooManyRequests(res, 60000);
    if (!allowRate("signup:" + clientIp(req), 60000, 5)) return tooManyRequests(res, 60000);

    const body = parseBody(req.body);
    if (!body || typeof body !== "object" || !body.data) {
      return res.status(400).send("Error: no request body.");
    }

    // 1) 服务端强制校验报名时间窗
    const win = signupWindowState(data);
    if (!win.ok) return res.status(400).send("Error: " + win.msg);

    // 2) 字段校验（必填/长度/格式），防止空值与脏数据落库
    const raw = typeof body.data === "object" ? body.data : {};
    const name = String(raw.name === undefined ? "" : raw.name).trim();
    const classes = String(raw.classes === undefined ? "" : raw.classes).trim();
    const email = String(raw.email === undefined ? "" : raw.email)
      .trim()
      .toLowerCase();
    const phone = String(raw.phone === undefined ? "" : raw.phone).trim();
    if (!name || name.length > 20) return res.status(400).send("Error: 姓名不合法（1-20 字）");
    if (!classes || classes.length > 30)
      return res.status(400).send("Error: 班级不合法（1-30 字）");
    if (!isValidEmailAddr(email)) return res.status(400).send("Error: 邮箱格式不正确");
    if (!isValidPhoneNo(phone)) return res.status(400).send("Error: 手机号格式不正确");

    // 3) 键校验：同数字时间戳键不可覆盖（旧实现可直接覆写他人报名）
    const tkey = String(body.timestamp === undefined ? "" : body.timestamp);
    if (!/^\d{1,16}$/.test(tkey)) return res.status(400).send("Error: 参数错误");
    if (!data.partList || typeof data.partList !== "object") data.partList = {};
    if (data.partList[tkey]) return res.status(400).send("Error: 请勿重复提交");

    // 4) 去重：同一邮箱或手机号只能报名一次
    const dup = Object.keys(data.partList).some((k) => {
      const v = data.partList[k];
      if (!v || typeof v !== "object") return false;
      return (
        String(v.email || "").trim().toLowerCase() === email ||
        String(v.phone || "").trim() === phone
      );
    });
    if (dup) return res.status(400).send("Error: 该邮箱或手机号已报名，请勿重复提交");

    // 5) 总量上限，防止数据无限膨胀
    if (Object.keys(data.partList).length >= SIGNUP_MAX_TOTAL) {
      return tooManyRequests(res, 60000);
    }

    data.partList[tkey] = {
      name: name,
      classes: classes,
      email: email,
      phone: phone,
    };
    saveData(data);
    return res.send("Success");
  } else if (req.method === "GET") { // 报名列表：需登录
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    return res.json(data.partList || {});
  } else if (req.method === "DELETE") { // 删除报名：需管理员
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
    const body = parseBody(req.body);
    if (body.timestamp && data.partList && data.partList[String(body.timestamp)]) {
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
  } else if (req.method === "POST") { // 报名时间/跳转链接：需管理员
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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

// ==== 社团人数（读取公开，保存需登录）====
app.all("/api/MemberConfigHandler", (req, res) => {
  const data = loadData();
  if (req.method === "GET") {
    // 公开读取：主页社团人数为游客展示，不能要求登录
    return res.json(data.memberCount || { newbie: 0, management: 0 });
  } else if (req.method === "POST") {
    // 保存人数：需管理员（后台 MemberManager 使用）
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
app.all("/api/MemberListHandler", (req, res) => {
  const data = loadData();
  const list = ensureMembers(data);
  if (req.method === "GET") {
    // 名单读取：需登录（普通用户可查看，后台签到/人员页使用）
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
    return res.json(membersToJSON(list));
  } else if (req.method === "POST") { // 新增人员：需管理员
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
  } else if (req.method === "DELETE") { // 删除人员：需管理员
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
    draw.active = body.setActive === true;
    saveData(data);
    return res.send("Success");
  }

  // 保存奖项配置（管理）
  if (body.saveConfig !== undefined) {
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
    draw.participants = [];
    saveData(data);
    return res.send("Success");
  }

  // 执行抽奖（管理）
  if (body.execDraw === true) {
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
    draw.participants = [];
    draw.results = [];
    saveData(data);
    return res.send("Success");
  }

  // 清空中奖公示历史（管理）
  if (body.clearHistory === true) {
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
    draw.history = [];
    saveData(data);
    return res.send("Success");
  }

  // 删除某一轮历史公示（管理）：body.deleteHistory 传该轮的 time 或 index
  if (body.deleteHistory !== undefined) {
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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

// ==== 直播地址脱敏 ====
// 公开接口不得下发源站真实 IP/端口（否则 CF 隐藏源站失效）。
// 统一改写为对外域名（经 Cloudflare 隧道回源到本机直播服务）。
const LIVE_PUBLIC_HOST = (process.env.LIVE_PUBLIC_HOST || "live.chunbosama.xyz").trim();
const IPV4_RE_SRC = "\\b\\d{1,3}(?:\\.\\d{1,3}){3}(?::\\d+)?";
function hasIpv4(s) {
  return new RegExp(IPV4_RE_SRC).test(s);
}
function publicLiveUrl(u) {
  if (typeof u !== "string") return "";
  let s = u.trim();
  if (!s) return "";
  // 站内相对路径：原样返回
  if (s.startsWith("/")) return s;
  const hadHttp = /^http:\/\//i.test(s);
  const hadScheme = /^https?:\/\//i.test(s);
  s = s.replace(/^https?:\/\//i, "");
  const hadIp = hasIpv4(s);
  // 任何 IPv4[:端口] 字面量一律替换为对外域名
  s = s.replace(new RegExp(IPV4_RE_SRC, "g"), LIVE_PUBLIC_HOST);
  // 必须输出绝对 URL：/live 页用 window.location.href 跳转，无协议会被当相对路径
  // 源站 IP 或本服务对外域名一律走 https（经 Cloudflare 回源）
  const hostLower = s.toLowerCase();
  const pubLower = LIVE_PUBLIC_HOST.toLowerCase();
  if (hadIp || hostLower === pubLower || hostLower.startsWith(pubLower + "/")) {
    return "https://" + s;
  }
  const scheme = hadHttp ? "http" : "https";
  return (hadScheme ? scheme + "://" : "https://") + s;
}

// ==== 直播链接（读取公开，保存需登录）====
app.all("/api/LiveConfigHandler", (req, res) => {
  const data = loadData();
  if (req.method === "GET") {
    // 公开读取：直播页/导航栏都是游客访问（输出前脱敏）
    return res.json({ url: publicLiveUrl(data.liveUrl || "") });
  } else if (req.method === "POST") {
    // 保存链接：需管理员
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
    const body = parseBody(req.body);
    data.liveUrl = publicLiveUrl(body.url || "");
    saveData(data);
    return res.send("Success");
  }
  return res.status(400).send("Error: unknown error");
});

// ==== 用户管理（列表需管理员，编辑/删除需超级管理员）====
// 说明：普通用户无权限；管理员可查看用户列表但不可编辑/删除；超级管理员可全操作
app.all("/api/UserAdminHandler", (req, res) => {
  const email = getSessionEmail(req);
  if (!email) return res.status(401).send("Error: 未登录或会话已过期");
  const data = loadData();
  migrateUsers(data);
  const role = getRole(data, email);

  if (req.method === "GET") {
    // 查看用户列表：需管理员及以上
    if (!roleAtLeast(role, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
    const list = Object.keys(data.users).map((e) => userToJSON(e, data.users[e]));
    list.sort((a, b) => a.createdAt - b.createdAt);
    return res.json({ users: list, current: email });
  }

  // 编辑/删除：仅超级管理员
  if (!roleAtLeast(role, "super")) return res.status(403).send("Error: 权限不足（需超级管理员）");
  const body = parseBody(req.body) || {};

  if (req.method === "DELETE") {
    // 删除用户：{ email }
    const target = String(body.email || "").trim().toLowerCase();
    if (!target) return res.status(400).send("Error: 缺少邮箱");
    if (!data.users[target]) return res.status(404).send("Error: 用户不存在");
    if (target === email) return res.status(400).send("Error: 不能删除当前登录账号");
    delete data.users[target];
    saveData(data);
    return res.send("Success");
  }

  if (req.method === "POST" || req.method === "PUT") {
    // 编辑用户：可改 role / nick / active / 重置密码 / 改邮箱
    const target = String(body.email || "").trim().toLowerCase();
    if (!target) return res.status(400).send("Error: 缺少邮箱");
    if (!data.users[target]) return res.status(404).send("Error: 用户不存在");

    // 保护：不能降级/删除唯一超级管理员自身，也不能删掉最后一个超级管理员
    const targetRole = getRole(data, target);
    if (String(body.role) === "user" && targetRole === "super" && target === email) {
      return res.status(400).send("Error: 不能取消自己的超级管理员身份");
    }
    const superCount = Object.keys(data.users).filter((e) => getRole(data, e) === "super").length;
    if (targetRole === "super" && String(body.role) && String(body.role) !== "super" && superCount <= 1) {
      return res.status(400).send("Error: 至少保留一个超级管理员");
    }

    const u = data.users[target];
    if (body.role && ROLES[String(body.role)] !== undefined) u.role = String(body.role);
    if (body.nick !== undefined) u.nick = String(body.nick).trim();
    if (body.active !== undefined) u.active = body.active === true || body.active === "true";
    if (body.password) u.hash = hashPassword(body.password, target);

    // 改邮箱
    if (body.newEmail) {
      const ne = String(body.newEmail).trim().toLowerCase();
      if (ne !== target) {
        if (data.users[ne]) return res.status(400).send("Error: 新邮箱已被占用");
        data.users[ne] = u;
        delete data.users[target];
      }
    }
    saveData(data);
    return res.json({ msg: "Success" });
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
    // 以下为管理操作：需管理员
    if (body.setSubtitle !== undefined || body.publish !== undefined) {
      if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
      if (body._saveDatas !== undefined) { // 管理保存投票配置：需管理员
        if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
        data.votes.datas = body._saveDatas || {};
        if (body._clearRecords === true) data.votes.records = [];
        saveData(data);
        return res.send("Success");
      }
      if (!data.votes.records) data.votes.records = [];
      // 投票提交：单 IP 限速（另加全局兜底闸）
      if (!allowRate("vote:global", 60000, 300)) {
        return tooManyRequests(res, 60000);
      }
      if (!allowRate("vote:" + clientIp(req), 60000, 20)) {
        return tooManyRequests(res, 60000);
      }
      const ids = Object.keys(body).filter((k) => k !== "_saveDatas");
      if (ids.length === 0) return res.status(400).send("Error: 参数错误");

      // 严格校验：投票 ID 必须存在；选项必须是合法选项名，去重且不超过 max。
      // 旧实现零校验，id/选项任意取值都返回 Success，会写入脏数据。
      const datas = data.votes.datas || {};
      const chosen = [];
      for (const id of ids) {
        const cfg = datas[String(id)];
        if (!cfg || typeof cfg !== "object") {
          return res.status(400).send("Error: 投票不存在");
        }
        const rawItems = body[id];
        if (!Array.isArray(rawItems) || rawItems.length === 0) {
          return res.status(400).send("Error: 请选择投票选项");
        }
        const maxSel = Number(cfg.max) > 0 ? Math.floor(Number(cfg.max)) : 1;
        const options = cfg.items && typeof cfg.items === "object" ? cfg.items : {};
        const items = [];
        for (const it of rawItems) {
          const key = String(it);
          if (!Object.prototype.hasOwnProperty.call(options, key)) {
            return res.status(400).send("Error: 选项不存在");
          }
          if (!items.includes(key)) items.push(key);
        }
        if (items.length > maxSel) {
          return res.status(400).send("Error: 最多只能选择 " + maxSel + " 项");
        }
        chosen.push({ id: String(id), items: items });
      }

      // 服务端防重复：投票者身份由服务端派生（IP+UA），客户端无法伪造新身份
      const voterHash = voterId(req);
      const votedIds = new Set(
        (data.votes.records || [])
          .filter((r) => r && r.voter === voterHash)
          .map((r) => String(r.id))
      );
      if (chosen.some((c) => votedIds.has(c.id))) {
        return res.status(400).send("Error: 您已经投过票了");
      }
      if (data.votes.records.length >= 20000) {
        return tooManyRequests(res, 60000);
      }
      for (const c of chosen) {
        data.votes.records.push({
          id: c.id,
          items: c.items,
          time: Date.now(),
          voter: voterHash,
        });
      }
      saveData(data);
      return res.send("Success");
    }
    return res.status(400).send("Error: 参数错误");
  }
  return res.status(400).send("Error: unknown error");
});

// ==== Q&A ====
// 安全设计：公开提交只能「新增提问」，不能指定/覆盖已有条目：
//  - 键由服务端生成（数字时间戳，兼容后台按 timestamp 编辑的 UI）
//  - 单条限长、单 IP 限速、总量上限
// 后台编辑（带 timestamp 更新既有条目）需要管理员权限。
const QA_MAX_LEN = 200;
const QA_MAX_TOTAL = 1000;
app.all("/api/QAHandler", (req, res) => {
  const data = loadData();
  if (!data.qa || typeof data.qa !== "object") data.qa = {};
  if (req.method === "POST") {
    const body = parseBody(req.body);
    if (!body || typeof body !== "object") return res.status(400).send("Error: no request body.");

    // 后台编辑：{ timestamp, data } —— 需管理员，可更新/新增指定条目
    if (body.timestamp !== undefined && reqRoleAtLeast(req, "admin")) {
      data.qa[String(body.timestamp)] = body.data || { question: "", answer: "" };
      saveData(data);
      return res.send("Success");
    }

    // 公开提交：{ timestamp(忽略), data:{ question } }
    if (body.timestamp !== undefined) {
      if (!allowRate("qa:" + clientIp(req), 60000, 5)) {
        return tooManyRequests(res, 60000);
      }
      const raw = body.data && typeof body.data === "object" ? body.data : {};
      const question = String(raw.question || "")
        .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
        .trim();
      if (!question) return res.status(400).send("Error: 问题内容不能为空");
      if (question.length > QA_MAX_LEN) {
        return res.status(400).send("Error: 问题过长（最多 " + QA_MAX_LEN + " 字）");
      }
      if (Object.keys(data.qa).length >= QA_MAX_TOTAL) {
        return tooManyRequests(res, 60000);
      }
      // 服务端生成唯一数字键：客户端无法指定键，因而无法覆盖已有条目
      let key = Date.now();
      while (data.qa[String(key)]) key += 1;
      data.qa[String(key)] = {
        question: question,
        answer: "",
        createdAt: Date.now(),
      };
      saveData(data);
      return res.send("Success");
    }

    // 删除问题/答案：需管理员
    if (body.delete !== undefined) {
      if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
    if (body.get === "user") { // 用户数据：需登录（不返回密码哈希）
      if (!getSessionEmail(req)) return res.status(401).json({ msg: "Error: 未登录或会话已过期" });
      const em = String(body.email || "").trim().toLowerCase();
      const u = data.users[em] ? normalizeUser(em, data.users[em]) : null;
      return res.json(u ? userToJSON(em, u) : null);
    }
  }
  // 写经费：需管理员
  if (body.__economy && body.__economy.economy) {
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).json({ msg: "Error: 权限不足（需管理员）" });
    data.economy = body.__economy.economy;
    saveData(data);
    return res.json({ msg: "Success" });
  }
  return res.status(400).json({ msg: "Error: unknown error" });
});

// ==== 博客（读列表需登录，写需管理员）====
app.all("/api/BlogHandler", (req, res) => {
  if (req.method === "GET") {
    // 列表/单篇读取：需登录（普通用户可查看）
    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
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
  } else if (req.method === "POST") { // 删除/保存/重建：需管理员
    if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");
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
      ];
      const subtitle = (body.subtitle || "").trim();
      if (subtitle) {
        fmLines.push(`description: ${subtitle}`);
      }
      fmLines.push(
        "authors:",
        `  - name: ${(body.author || "匿名").trim()}`,
      );
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

// ==== 社团风采（照片墙）====
app.all("/api/GalleryHandler", (req, res) => {
  const data = loadData();
  if (!Array.isArray(data.gallery)) data.gallery = [];

  if (req.method === "GET") {
    // 公开：返回照片元数据列表
    const list = data.gallery.map((g) => ({
      id: g.id,
      url: g.url,
      caption: g.caption || "",
      addedAt: g.addedAt || 0,
    }));
    return res.json(list);
  }

  if (req.method !== "POST") {
    return res.status(400).send("Error: unknown error");
  }
  if (!reqRoleAtLeast(req, "admin")) return res.status(403).send("Error: 权限不足（需管理员）");

  const body = parseBody(req.body);

  // 上传照片：{ action: "upload", data: <base64>, ext: "jpg|png...", caption }
  if (body.action === "upload") {
    if (!body.data) return res.status(400).send("Error: 缺少图片数据");
    const ext = /^[a-zA-Z0-9]{1,5}$/.test(String(body.ext || "")) ? String(body.ext).toLowerCase() : "jpg";
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const filename = id + "." + ext;
    try {
      fs.mkdirSync(GALLERY_DIR, { recursive: true });
      const buf = Buffer.from(String(body.data), "base64");
      if (buf.length <= 0) return res.status(400).send("Error: 图片数据为空");
      if (buf.length > 15 * 1024 * 1024) return res.status(400).send("Error: 图片过大（最大 15MB）");
      fs.writeFileSync(path.join(GALLERY_DIR, filename), buf);
    } catch (e) {
      return res.status(500).send("Error: 保存图片失败");
    }
    data.gallery.push({
      id,
      url: "/gallery/" + filename,
      caption: String(body.caption || "").trim(),
      addedAt: Date.now(),
    });
    saveData(data);
    return res.json({ msg: "Success", id, url: "/gallery/" + filename });
  }

  // 删除照片
  if (body.action === "delete") {
    const idx = data.gallery.findIndex((g) => g.id === body.id);
    if (idx < 0) return res.status(400).send("Error: 未找到该照片");
    const file = path.join(GALLERY_DIR, path.basename((data.gallery[idx].url || "").replace("/gallery/", "")));
    try {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch (e) {}
    data.gallery.splice(idx, 1);
    saveData(data);
    return res.send("Success");
  }

  // 编辑说明文字
  if (body.action === "update") {
    const g = data.gallery.find((x) => x.id === body.id);
    if (!g) return res.status(400).send("Error: 未找到该照片");
    g.caption = String(body.caption || "").trim();
    saveData(data);
    return res.send("Success");
  }

  return res.status(400).send("Error: unknown error");
});

// ==== OIDC Provider（单点登录身份提供商）====
// 供外部服务（如 OpenList）通过官网账号体系 SSO 登录。
// 环境变量 OIDC_ENABLED=1 时启用；详情见 oidc-provider.js。
// 注意：必须在下方 SPA 回退（catch-all）之前注册，否则请求会被 index.html 吞掉。
try {
  const oidcProvider = require(path.join(__dirname, "oidc-provider.js"));
  oidcProvider.register(app, {
    getSessionEmail, // 复用官网登录态（si_session cookie / Bearer）
    loadData, // 用户数据读取
  });
} catch (e) {
  console.error("[OIDC] 加载失败:", e && e.message);
}

// ==== 静态文件服务（生产构建 build/）====
// 社团风采照片目录：运行时上传，独立于 build，重建不丢失
app.use("/gallery", express.static(GALLERY_DIR));

app.use(express.static(BUILD_DIR));

// 预扫描构建产物中的真实页面路由（含 index.html 的目录），用于精确 404
const PAGE_ROUTES = (() => {
  const set = new Set(["/"]);
  const walk = (dir, rel) => {
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    if (ents.some((e) => e.isFile() && e.name === "index.html")) set.add(rel + "/");
    for (const e of ents) {
      if (e.isDirectory()) walk(path.join(dir, e.name), rel + "/" + e.name);
    }
  };
  walk(BUILD_DIR, "");
  return set;
})();

// 兜底：不再把所有未命中路径都回退 index.html（避免软 404 与路径探测）
// 注意：404 一律 no-store，避免被 Cloudflare 按浏览器缓存 TTL 长期缓存（缓存污染）
function noStore(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  return res;
}
app.use((req, res) => {
  // API 路径：返回 JSON 404
  if (req.path.startsWith("/api/")) return noStore(res).status(404).json({ msg: "Error: not found" });
  // 静态资源类请求（带扩展名）：返回纯文本 404
  if (path.extname(req.path)) return noStore(res).status(404).type("txt").send("Not Found");
  // 页面类请求：仅命中真实路由时回退 index.html
  if (req.method === "GET") {
    const normalized = req.path.endsWith("/") ? req.path : req.path + "/";
    if (PAGE_ROUTES.has(normalized)) return res.sendFile(path.join(BUILD_DIR, "index.html"));
    const f404 = path.join(BUILD_DIR, "404.html");
    if (fs.existsSync(f404)) {
      // sendFile 会自行写入 Cache-Control，这里用 headers 选项确保 no-store
      return res
        .status(404)
        .sendFile(f404, { headers: { "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0" } });
    }
  }
  return noStore(res)
    .status(404)
    .type("html")
    .send("<!DOCTYPE html><html><head><title>404</title></head><body><h1>404 Not Found</h1></body></html>");
});

// 启动时迁移用户数据（旧字符串哈希 -> 对象格式）并确保初始超级管理员存在
try {
  const d = loadData();
  migrateUsers(d);
  if (d.users[SUPER_ADMIN_EMAIL]) {
    d.users[SUPER_ADMIN_EMAIL].role = "super";
    saveData(d);
  }
} catch (e) {}

// 仅监听回环地址：站点只能由本机 cloudflared 回源访问，公网无法直连源站
const BIND_HOSTS = (process.env.BIND_HOST || "127.0.0.1,::1")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
for (const host of BIND_HOSTS) {
  const srv = app.listen(PORT, host, () => {
    console.log(`[生产服务器] 监听 http://${host}:${PORT} （静态目录: ${BUILD_DIR}）`);
  });
  srv.on("error", (e) => {
    console.error(`[生产服务器] 监听 ${host}:${PORT} 失败: ${e && e.message}`);
  });
}
