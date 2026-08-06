/**
 * 本地开发中间件插件
 * 让 Docusaurus dev server 处理注册/登录接口（模拟 Cloudflare KV）
 * 数据保存在 local-data/users.json
 */
const path = require("path");
const fs = require("fs");
const express = require("express");
const bodyParser = require("body-parser");

// 数据文件使用绝对路径，避免 webpack 重写 __dirname 导致的路径错乱
const DATA_FILE = "/home/admin/.openclaw/workspace/si-website/local-data/users.json";

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
  } catch (e) {
    return { registerCode: "siai", users: {} };
  }
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
            router.post("/api/RegisterHandler", (req, res) => {
              let body = req.body || {};
              // fetch 默认不设置 Content-Type，body 可能是字符串，手动解析 JSON
              if (typeof body === "string") {
                try {
                  body = JSON.parse(body);
                } catch (e) {
                  body = {};
                }
              }
              const data = loadData();
              if (body.code !== data.registerCode) {
                return res.status(400).send("Error: wrong code.");
              }
              if (!body.email || !body.password) {
                return res.status(400).send("Error: no request body.");
              }
              data.users[body.email] = body.password;
              saveData(data);
              return res.send("Success");
            });

            // 登录接口（返回该用户加密密码，未找到返回空）
            router.post("/api/LoginHandler", (req, res) => {
              let body = req.body || {};
              if (typeof body === "string") {
                try {
                  body = JSON.parse(body);
                } catch (e) {
                  body = {};
                }
              }
              const data = loadData();
              if (!body || !body.email) {
                return res.status(400).send("Error: no request body.");
              }
              return res.send(data.users[body.email] || "");
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
                return res.json(data.partList || {});
              } else if (req.method === "DELETE") {
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

            // 直播链接配置：GET 读取 / POST 保存
            router.all("/api/LiveConfigHandler", (req, res) => {
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
                  const event = url.searchParams.get("event");
                  return res.json(data.signin.records[event] || []);
                }
                if (get === "events") {
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
                // 缺省返回所有记录
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

                // 设置副标题
                if (body.setSubtitle !== undefined) {
                  data.signin.subtitle = String(body.setSubtitle);
                  saveData(data);
                  return res.send("Success");
                }
                // 发布签到：开启一个新的签到事件
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
                // 停止签到
                if (body.publish === false) {
                  data.signin.active = false;
                  saveData(data);
                  return res.send("Success");
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
                  // 后台保存投票配置
                  if (body._saveDatas !== undefined) {
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
                // 提交问题：{ timestamp, data: {question, answer} }
                if (body.timestamp) {
                  data.qa[String(body.timestamp)] = body.data || {
                    question: "",
                    answer: "",
                  };
                  saveData(data);
                  return res.send("Success");
                }
                // 删除：{ delete: timestamp }
                if (body.delete !== undefined) {
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
              // 读取
              if (body.get) {
                const what = body.get;
                if (what === "economy") {
                  return res.json({ economy: data.economy || [] });
                }
                if (what === "user") {
                  const email = body.email;
                  return res.json(data.users[email] || null);
                }
              }
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
