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

            app.use(router);
            return middlewares;
          },
        },
      };
    },
  };
};
