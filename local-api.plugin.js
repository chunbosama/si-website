/**
 * 本地开发中间件插件
 * 让 Docusaurus dev server 处理注册/登录接口（模拟 Cloudflare KV）
 * 数据保存在 local-data/users.json
 */
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const express = require("express");
const bodyParser = require("body-parser");

// 数据文件使用绝对路径，避免 webpack 重写 __dirname 导致的路径错乱
const DATA_FILE = "/home/admin/.openclaw/workspace/si-website/local-data/users.json";

const SESSION_SECRET =
  process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");
const SESSION_COOKIE = "si_session";
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function createSessionToken(email) {
  const payload = `${email}|${Date.now() + SESSION_TTL_MS}`;
  const sig = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("hex");
  return Buffer.from(payload + "|" + sig).toString("base64url");
}
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
  const a = Buffer.from(String(sig));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  if (Number(expiry) < Date.now()) return null;
  return email;
}
function parseCookies(str) {
  const out = {};
  String(str || "").split(";").forEach((c) => {
    const idx = c.indexOf("=");
    if (idx > 0) out[c.slice(0, idx).trim()] = c.slice(idx + 1).trim();
  });
  return out;
}
function getSessionEmail(req) {
  const cookie = parseCookies(req.headers.cookie);
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
function hashPassword(password, email) {
  return crypto.createHash("md5").update(String(password) + ":" + String(email)).digest("hex");
}
const rateBuckets = {};
function rateLimit(opts) {
  const { windowMs = 60000, max = 60 } = opts || {};
  return (req, res, next) => {
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const b = rateBuckets[ip];
    if (!b || b.resetAt < now) {
      rateBuckets[ip] = { count: 1, resetAt: now + windowMs };
      return next();
    }
    b.count += 1;
    if (b.count > max) return res.status(429).send("Error: 请求过于频繁");
    next();
  };
}

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
  if (data.registerCode) {
    data.registerCodes = [String(data.registerCode)];
    return data.registerCodes;
  }
  return [];
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
}

/** @type {import('@docusaurus/types').Plugin} */
module.exports = function localApiPlugin(context, options) {
  return {
    name: "local-api-plugin",
    configureWebpack() {
      return {
        devServer: {
          setupMiddlewares(middlewares, devServer) {
            if (!devServer || !devServer.app) return middlewares;

            const app = devServer.app;
            const router = express.Router();
            router.use(bodyParser.text({ type: () => true }));

            // 注册接口
            router.post("/api/RegisterHandler", rateLimit({ windowMs: 60000, max: 10 }), (req, res) => {
              let body = req.body || {};
              if (typeof body === "string") {
                try {
                  body = JSON.parse(body);
                } catch (e) {
                  body = {};
                }
              }
              const data = loadData();
              if (!getRegisterCodes(data).includes(String(body.code || ""))) {
                return res.status(400).send("Error: wrong code.");
              }
              if (!body.email || !body.password) {
                return res.status(400).send("Error: no request body.");
              }
              const email = String(body.email).trim().toLowerCase();
              if (email === "__proto__" || email === "prototype" || email === "constructor") {
                return res.status(400).send("Error: invalid email.");
              }
              if (data.users[email]) return res.status(400).send("Error: 该邮箱已注册");
              data.users[email] = hashPassword(body.password, email);
              saveData(data);
              res.cookie(SESSION_COOKIE, createSessionToken(email), {
                httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS,
              });
              return res.send("Success");
            });

            // 注册码管理：GET 列出 / POST 添加 / DELETE 删除
            router.all("/api/CodeHandler", (req, res) => {
              if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
              const data = loadData();
              getRegisterCodes(data);
              if (!Array.isArray(data.registerCodes)) data.registerCodes = [];
              const lower = (s) => String(s).toLowerCase().trim();

              if (req.method === "GET") {
                return res.json({ codes: data.registerCodes });
              } else if (req.method === "POST") {
                let body = req.body || {};
                if (typeof body === "string") {
                  try { body = JSON.parse(body); } catch (e) { body = {}; }
                }
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
                let body = req.body || {};
                if (typeof body === "string") {
                  try { body = JSON.parse(body); } catch (e) { body = {}; }
                }
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

            // 登录接口：服务端校验密码，返回结果而不泄露存储哈希
            router.post("/api/LoginHandler", rateLimit({ windowMs: 60000, max: 10 }), (req, res) => {
              let body = req.body || {};
              if (typeof body === "string") {
                try {
                  body = JSON.parse(body);
                } catch (e) {
                  body = {};
                }
              }
              const data = loadData();
              if (!body || !body.email || !body.password) {
                return res.status(400).send("Error: no request body.");
              }
              const email = String(body.email).trim().toLowerCase();
              const stored = data.users[email];
              if (!stored || hashPassword(body.password, email) !== stored) {
                return res.status(401).send("Error: 账号或密码错误");
              }
              res.cookie(SESSION_COOKIE, createSessionToken(email), {
                httpOnly: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL_MS,
              });
              return res.send("Success");
            });
            // 登出 + 会话状态
            router.post("/api/LogoutHandler", (req, res) => {
              res.clearCookie(SESSION_COOKIE, { path: "/" });
              return res.send("Success");
            });
            router.get("/api/SessionHandler", (req, res) => {
              const email = getSessionEmail(req);
              return res.json({ loggedIn: !!email, email: email || null });
            });

            // 报名接口：POST 提交报名 / GET 获取报名列表
            router.all("/api/SignUpHandler", (req, res) => {
              const data = loadData();
              if (req.method === "POST") {
                let body = req.body || {};
                if (typeof body === "string") {
                  try {
                    body = JSON.parse(body);
                  } catch (e) {
                    body = {};
                  }
                }
                if (!body || body.timestamp === undefined || !body.data) {
                  return res.status(400).send("Error: no request body.");
                }
                data.partList[String(body.timestamp)] = body.data;
                saveData(data);
                return res.send("Success");
              } else if (req.method === "GET") {
                if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                return res.json(data.partList || {});
              } else if (req.method === "DELETE") {
                if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                let body = req.body || {};
                if (typeof body === "string") {
                  try {
                    body = JSON.parse(body);
                  } catch (e) {
                    body = {};
                  }
                }
                if (body.timestamp && data.partList[String(body.timestamp)]) {
                  delete data.partList[String(body.timestamp)];
                  saveData(data);
                  return res.send("Success");
                }
                return res.status(400).send("Error: not found");
              }
              return res.status(400).send("Error: unknown error");
            });

            // 报名时间配置：GET 读取 / POST 保存
            router.all("/api/SignUpConfigHandler", (req, res) => {
              const data = loadData();
              if (req.method === "GET") {
                return res.json({
                  start: (data.signupTime && data.signupTime.start) || "",
                  end: (data.signupTime && data.signupTime.end) || "",
                  submitRedirectUrl: data.submitRedirectUrl || "",
                });
              } else if (req.method === "POST") {
                if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                let body = req.body || {};
                if (typeof body === "string") {
                  try {
                    body = JSON.parse(body);
                  } catch (e) {
                    body = {};
                  }
                }
                // 只更新调用方传入的字段，避免互相覆盖
                const cur = data.signupTime || { start: "", end: "" };
                if (body.start !== undefined) cur.start = body.start || "";
                if (body.end !== undefined) cur.end = body.end || "";
                data.signupTime = cur;
                if (body.submitRedirectUrl !== undefined) {
                  data.submitRedirectUrl = String(body.submitRedirectUrl) || "";
                }
                saveData(data);
                return res.send("Success");
              }
              return res.status(400).send("Error: unknown error");
            });

            // 社团人数配置：GET 读取 / POST 保存
            router.all("/api/MemberConfigHandler", (req, res) => {
              if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
              const data = loadData();
              if (req.method === "GET") {
                return res.json(
                  data.memberCount || { newbie: 0, management: 0 }
                );
              } else if (req.method === "POST") {
                let body = req.body || {};
                if (typeof body === "string") {
                  try {
                    body = JSON.parse(body);
                  } catch (e) {
                    body = {};
                  }
                }
                data.memberCount = {
                  newbie: Number.isFinite(Number(body.newbie))
                    ? Number(body.newbie)
                    : 0,
                  management: Number.isFinite(Number(body.management))
                    ? Number(body.management)
                    : 0,
                };
                saveData(data);
                return res.send("Success");
              }
              return res.status(400).send("Error: unknown error");
            });

            // 人员名单：GET 读取 / POST 新增(可批量) / DELETE 删除
            const ensureMembers = (data) => {
              if (!Array.isArray(data.members)) data.members = [];
              return data.members;
            };
            const membersToJSON = (list) =>
              list.map((m) => ({
                name: String((m && m.name) || ""),
                position: String((m && m.position) || ""),
                addedAt: Number((m && m.addedAt) || 0),
              }));
            router.all("/api/MemberListHandler", (req, res) => {
              if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
              const data = loadData();
              const list = ensureMembers(data);
              if (req.method === "GET") {
                return res.json(membersToJSON(list));
              } else if (req.method === "POST") {
                let body = req.body || {};
                if (typeof body === "string") {
                  try { body = JSON.parse(body); } catch (e) { body = {}; }
                }
                let names = [];
                if (typeof body.names === "string") {
                  names = body.names
                    .split(/[\n,，]+/)
                    .map((s) => String(s).trim())
                    .filter(Boolean);
                } else if (Array.isArray(body.names)) {
                  names = body.names
                    .map((s) => String(s && s.name !== undefined ? s.name : s).trim())
                    .filter(Boolean);
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
                let body = req.body || {};
                if (typeof body === "string") {
                  try { body = JSON.parse(body); } catch (e) { body = {}; }
                }
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

            // 抽奖接口
            router.all("/api/DrawHandler", (req, res) => {
              const data = loadData();
              if (!data.draw) {
                data.draw = { config: [], active: false, participants: [], results: [] };
              }
              const draw = data.draw;
              if (!Array.isArray(draw.config)) draw.config = [];
              if (!Array.isArray(draw.participants)) draw.participants = [];
              if (!Array.isArray(draw.results)) draw.results = [];

              if (req.method === "GET") {
                const url = new URL(req.url, "http://localhost");
                if (url.searchParams.get("get") === "state") {
                  return res.json({
                    active: draw.active,
                    config: draw.config,
                    participants: draw.participants,
                    results: draw.results,
                  });
                }
                return res.status(400).json({ msg: "Error: unknown type" });
              }
              if (req.method !== "POST") {
                return res.status(400).json({ msg: "Error: unknown error" });
              }

              let body = req.body || {};
              if (typeof body === "string") {
                try { body = JSON.parse(body); } catch (e) { body = {}; }
              }

              // 参与抽奖
              if (body.participate === true && body.name) {
                if (!draw.active) return res.status(400).send("Error: 抽奖未开放");
                const name = String(body.name).trim();
                const members = ensureMembers(data);
                const lower = (n) => String(n).toLowerCase();
                if (!members.some((m) => lower(m.name) === lower(name))) {
                  return res.status(400).send("Error: 您不在人员名单中，无法参与");
                }
                if (draw.participants.some((n) => lower(n) === lower(name))) {
                  return res.status(400).send("Error: 您本轮已参与过，不能重复参与");
                }
                draw.participants.push(name);
                saveData(data);
                return res.send("Success");
              }

              // 开放/关闭参与（需登录）
              if (body.setActive !== undefined) {
                if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                draw.active = body.setActive === true;
                saveData(data);
                return res.send("Success");
              }

              // 保存奖项配置（需登录）
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

              // 清空参与者（需登录）
              if (body.clearParticipants === true) {
                if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                draw.participants = [];
                saveData(data);
                return res.send("Success");
              }

              // 执行抽奖（需登录）
              if (body.execDraw === true) {
                if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                const total = draw.config.reduce((s, p) => s + (p.count || 0), 0);
                if (total <= 0) return res.status(400).send("Error: 未配置奖项");
                if (draw.participants.length === 0) return res.status(400).send("Error: 暂无可参与抽奖的人");
                const pool = [...draw.participants];
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
                saveData(data);
                return res.json({ msg: "Success", results });
              }

              // 重置整轮（需登录）
              if (body.reset === true) {
                if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                draw.participants = [];
                draw.results = [];
                saveData(data);
                return res.send("Success");
              }

              return res.status(400).json({ msg: "Error: unknown error" });
            });

            // 直播链接配置：GET 读取 / POST 保存
            router.all("/api/LiveConfigHandler", (req, res) => {
              if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
              const data = loadData();
              if (req.method === "GET") {
                return res.json({ url: data.liveUrl || "" });
              } else if (req.method === "POST") {
                let body = req.body || {};
                if (typeof body === "string") {
                  try {
                    body = JSON.parse(body);
                  } catch (e) {
                    body = {};
                  }
                }
                data.liveUrl = body.url || "";
                saveData(data);
                return res.send("Success");
              }
              return res.status(400).send("Error: unknown error");
            });

            // 签到接口
            router.all("/api/SigninHandler", (req, res) => {
              const data = loadData();
              if (!data.signin) {
                data.signin = {
                  active: false,
                  activeEvent: "",
                  subtitle: "",
                  records: {},
                };
              }

              // 确保当前事件有记录数组
              const ensureEvent = () => {
                if (
                  data.signin.activeEvent &&
                  !data.signin.records[data.signin.activeEvent]
                ) {
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
                    records: data.signin.active
                      ? data.signin.records[data.signin.activeEvent] || []
                      : [],
                  });
                }
                if (get === "records") {
                  if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                  const event = url.searchParams.get("event");
                  return res.json(data.signin.records[event] || []);
                }
                if (get === "events") {
                  if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                  // 返回所有签到事件列表（id + 时间 + 人数），按时间倒序
                  const events = Object.keys(data.signin.records || {}).map(
                    (ev) => ({
                      event: ev,
                      time: Number(ev),
                      count: (data.signin.records[ev] || []).length,
                    })
                  );
                  events.sort((a, b) => b.time - a.time);
                  return res.json(events);
                }
                // 缺省返回所有记录（需登录）
                if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                return res.json(data.signin.records || {});
              } else if (req.method === "POST") {
                let body = req.body || {};
                if (typeof body === "string") {
                  try {
                    body = JSON.parse(body);
                  } catch (e) {
                    body = {};
                  }
                }

                // 设置副标题（需登录）
                if (body.setSubtitle !== undefined) {
                  if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                  data.signin.subtitle = String(body.setSubtitle);
                  saveData(data);
                  return res.send("Success");
                }
                // 发布/停止签到（需登录）
                if (body.publish !== undefined) {
                  if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                  if (body.publish === true) {
                    const event = String(Date.now());
                    data.signin.active = true;
                    data.signin.activeEvent = event;
                    if (!data.signin.records[event]) {
                      data.signin.records[event] = [];
                    }
                    saveData(data);
                    return res.json({ msg: "Success", event: event });
                  }
                  if (body.publish === false) {
                    data.signin.active = false;
                    saveData(data);
                    return res.send("Success");
                  }
                }
                // 提交签到：{ name, event }
                if (body.name && body.event) {
                  if (!data.signin.active || data.signin.activeEvent !== body.event) {
                    return res.status(400).send("Error: 签到未开启");
                  }
                  const list = data.signin.records[body.event] || [];
                  // 校验名字是否在人员名单内
                  const members = ensureMembers(data);
                  const lower = (n) => String(n).toLowerCase();
                  const isMember = members.some((m) => lower(m.name) === lower(String(body.name)));
                  if (!isMember) {
                    return res.status(400).send("Error: 您不在人员名单中，无法签到");
                  }
                  // 去重：同一名字只签一次
                  const exists = list.some((r) => r.name === body.name);
                  if (exists) {
                    return res.status(400).send("Error: 已签到");
                  }
                  list.push({
                    name: body.name,
                    time: Date.now(),
                  });
                  data.signin.records[body.event] = list;
                  saveData(data);
                  return res.send("Success");
                }
                return res.status(400).send("Error: 参数错误");
              }
              return res.status(400).send("Error: unknown error");
            });

            // 投票接口
            router.all("/api/VoteHandler", (req, res) => {
              const data = loadData();
              if (!data.votes) {
                data.votes = { datas: {}, records: [] };
              }

              if (req.method === "GET") {
                const url = new URL(req.url, "http://localhost");
                const type = url.searchParams.get("type");
                if (type === "get") {
                  // 返回投票配置（datas）
                  return res.json(data.votes.datas || {});
                }
                if (type === "calc") {
                  // 统计投票结果：{ id: { itemIndex: 票数 } }
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
                let body = req.body || {};
                if (typeof body === "string") {
                  try {
                    body = JSON.parse(body);
                  } catch (e) {
                    body = {};
                  }
                }
                // body: { id: [选中的 item 索引], ... }，依次存入记录
                // 或 body: { _saveDatas: {datas}, _clearRecords: bool }（后台保存投票配置）
                if (typeof body === "object" && body !== null) {
                  // 后台保存投票配置（需登录）
                  if (body._saveDatas !== undefined) {
                    if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                    data.votes.datas = body._saveDatas || {};
                    if (body._clearRecords === true) {
                      data.votes.records = [];
                    }
                    saveData(data);
                    return res.send("Success");
                  }
                  if (!data.votes.records) data.votes.records = [];
                  for (const id of Object.keys(body)) {
                    data.votes.records.push({
                      id: id,
                      items: Array.isArray(body[id]) ? body[id] : [],
                      time: Date.now(),
                    });
                  }
                  saveData(data);
                  return res.send("Success");
                }
                return res.status(400).send("Error: 参数错误");
              }
              return res.status(400).send("Error: unknown error");
            });

            // Q&A 接口
            router.all("/api/QAHandler", (req, res) => {
              const data = loadData();
              if (!data.qa) {
                data.qa = {};
              }

              if (req.method === "POST") {
                let body = req.body || {};
                if (typeof body === "string") {
                  try {
                    body = JSON.parse(body);
                  } catch (e) {
                    body = {};
                  }
                }
                if (!body || typeof body !== "object") {
                  return res.status(400).send("Error: no request body.");
                }
                // 提交问题：{ timestamp, data: {question, answer} }（公开）
                if (body.timestamp) {
                  data.qa[String(body.timestamp)] = body.data || {
                    question: "",
                    answer: "",
                  };
                  saveData(data);
                  return res.send("Success");
                }
                // 删除：{ delete: timestamp }（需登录）
                if (body.delete !== undefined) {
                  if (!getSessionEmail(req)) return res.status(401).send("Error: 未登录或会话已过期");
                  delete data.qa[String(body.delete)];
                  saveData(data);
                  return res.send("Success");
                }
                return res.status(400).send("Error: unknown error");
              } else if (req.method === "GET") {
                // 返回所有 Q&A
                return res.json(data.qa);
              }
              return res.status(400).send("Error: unknown error");
            });

            // 数据接口（经费等）
            router.all("/api/DataHandler", (req, res) => {
              if (req.method !== "POST") {
                return res.status(400).send("Error: unknown error");
              }
              const data = loadData();
              let body = req.body || {};
              if (typeof body === "string") {
                try {
                  body = JSON.parse(body);
                } catch (e) {
                  body = {};
                }
              }
              if (!body || typeof body !== "object") {
                return res
                  .status(400)
                  .json({ msg: "Error: no request body" });
              }
              if (body.get && body.get === "economy") {
                return res.json({ economy: data.economy || [] }); // 公开只读
              }
              if (body.get && body.get === "user") {
                if (!getSessionEmail(req)) return res.status(401).json({ msg: "Error: 未登录或会话已过期" });
                return res.json(data.users[body.email] || null);
              }
              // 写经费：需登录
              if (!getSessionEmail(req)) return res.status(401).json({ msg: "Error: 未登录或会话已过期" });
              // 保存经费
              if (body.__economy && body.__economy.economy) {
                data.economy = body.__economy.economy;
                saveData(data);
                return res.json({ msg: "Success" });
              }
              return res
                .status(400)
                .json({ msg: "Error: unknown error" });
            });

            app.use(router);
            return middlewares;
          },
        },
      };
    },
  };
};
