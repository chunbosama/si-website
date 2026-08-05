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
                return res.json(data.signupTime || { start: "", end: "" });
              } else if (req.method === "POST") {
                let body = req.body || {};
                if (typeof body === "string") {
                  try {
                    body = JSON.parse(body);
                  } catch (e) {
                    body = {};
                  }
                }
                data.signupTime = {
                  start: body.start || "",
                  end: body.end || "",
                };
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

            app.use(router);
            return middlewares;
          },
        },
      };
    },
  };
};
