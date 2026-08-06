/**
 * 生产服务器：同时提供静态站点 + 本地 API 接口
 * 使用方式：node server.js [端口]
 */
const path = require("path");
const fs = require("fs");
const { execSync } = require("child_process");
const express = require("express");
const bodyParser = require("body-parser");

const PORT = process.env.PORT ? parseInt(process.env.PORT) : parseInt(process.argv[2] || "3000");
const BUILD_DIR = path.join(__dirname, "build");
const BLOG_DIR = path.join(__dirname, "blog");
const DATA_FILE = path.join(__dirname, "local-data", "users.json");

// ---- 本地数据读写（与 local-api.plugin.js 一致）----
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
app.use(bodyParser.text({ type: () => true }));

// ==== 注册 ====
app.post("/api/RegisterHandler", (req, res) => {
  const body = parseBody(req.body);
  const data = loadData();
  if (body.code !== data.registerCode) return res.status(400).send("Error: wrong code.");
  if (!body.email || !body.password) return res.status(400).send("Error: no request body.");
  data.users[body.email] = body.password;
  saveData(data);
  return res.send("Success");
});

// ==== 登录 ====
app.post("/api/LoginHandler", (req, res) => {
  const body = parseBody(req.body);
  const data = loadData();
  if (!body || !body.email) return res.status(400).send("Error: no request body.");
  return res.send(data.users[body.email] || "");
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
  } else if (req.method === "GET") {
    return res.json(data.partList || {});
  } else if (req.method === "DELETE") {
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
  } else if (req.method === "POST") {
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
app.all("/api/MemberConfigHandler", (req, res) => {
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

// ==== 人员名单 ====
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

// ==== 直播链接 ====
app.all("/api/LiveConfigHandler", (req, res) => {
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
    if (get === "records") {
      const event = url.searchParams.get("event");
      return res.json(data.signin.records[event] || []);
    }
    if (get === "events") {
      const events = Object.keys(data.signin.records || {}).map((ev) => ({
        event: ev,
        time: Number(ev),
        count: (data.signin.records[ev] || []).length,
      }));
      events.sort((a, b) => b.time - a.time);
      return res.json(events);
    }
    return res.json(data.signin.records || {});
  } else if (req.method === "POST") {
    const body = parseBody(req.body);
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
      if (body._saveDatas !== undefined) {
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
    if (body.timestamp) {
      data.qa[String(body.timestamp)] = body.data || { question: "", answer: "" };
      saveData(data);
      return res.send("Success");
    }
    if (body.delete !== undefined) {
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
    if (body.get === "economy") return res.json({ economy: data.economy || [] });
    if (body.get === "user") return res.json(data.users[body.email] || null);
  }
  if (body.__economy && body.__economy.economy) {
    data.economy = body.__economy.economy;
    saveData(data);
    return res.json({ msg: "Success" });
  }
  return res.status(400).json({ msg: "Error: unknown error" });
});

// ==== 博客 ====
app.all("/api/BlogHandler", (req, res) => {
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
