# si-website

惠州市第一中学智能信息社官方网站，基于 [Docusaurus](https://docusaurus.io/zh-CN/) + [TypeScript](https://www.typescriptlang.org/zh/) + [React](https://zh-hans.react.dev/)。

包含投票、报名、签到、抽奖、Q&A、博客、直播、社团经费展示等功能，并提供完整的**后台管理系统**。

## ✨ 功能模块

### 面向访客

| 模块 | 页面 | 说明 |
|------|------|------|
| 首页 | `/` | 社团简介入口、经费展示、成员人数 |
| 投票 | `/vote` | 在线投票（带实时结果统计） |
| 报名 | `/sign_up` | 纳新报名表单（受后台报名时间控制） |
| 签到 | `/check_in` | 活动签到（校验收人员名单/去重） |
| 抽奖 | `/draw` | 幸运抽奖（输入名字参与，须在人员名单内） |
| 直播 | `/live` | 跳转到直播平台 |
| Q&A | `/qa` | 提问与答疑 |
| 博客 | `/blog` | 社团博客文章 |
| 后台 | `/backend` | 登录后进入管理后台（见下方） |

### 后台管理（`/backend`）

| 模块 | 侧边栏 | 功能 |
|------|--------|------|
| 总览 | 总览 | 数据看板 |
| 经费 | 经费 | 经费数据管理 |
| 投票 | 投票 | 投票配置、结果统计 |
| 报名 | 报名 | 报名时间控制、跳转链接、报名列表 |
| 签到 | 签到 | 发起/停止签到、查看记录、未签到名单 |
| 抽奖 | 抽奖 | 设奖项、开/关参与、执行随机抽奖、中奖名单 |
| 人员 | 人员 | 社团人数配置、人员名单增删（批量） |
| 注册码 | 注册码 | 注册码增删（多注册码注册控制） |
| 直播 | 直播 | 直播链接配置 |
| 博客 | 博客 | 发布/编辑/删除博客、重建站点 |

## 🚀 快速开始（开发）

```bash
# 1. 安装依赖
npm install

# 2. 启动开发服务器（含本地 API 模拟）
npm start
```

开发模式下，`/api/*` 接口由本地中间件 `local-api.plugin.js` 提供，数据保存在 `local-data/users.json`。

## 🏭 生产部署（本地服务器 + Cloudflare Tunnel）

> **注意**：生产环境**不使用** Cloudflare Pages Functions（`functions/api/*` 仅供参考/迁移），
> 而是由本机 Node 服务 `server.js` 提供站点静态资源与全部 API 接口。

### 架构概览

```
访客 ──▶ Cloudflare（代理/隧道） ──▶ cloudflared（容器，host 网络）
        ──▶ 本机 nginx:80 ──▶ node server.js:3000
                                   │
                                   └──▶ 数据: local-data/users.json
```

- 域名通过 **Cloudflare Tunnel**（cloudflared 容器）回源到本机。
- `nginx` 监听 80 → 反向代理到 `node server.js:3000`。
- `server.js` 同时托管 `build/`（静态文件）与 `/api/*`（业务接口）。

### 构建并部署

```bash
# 1. 构建生产产物
npm run build

# 2. 启动生产服务器
node server.js 3000
```

推荐使用 systemd 托管（开机自启）：

```ini
# /etc/systemd/system/si-website.service
[Service]
WorkingDirectory=/path/to/si-website
ExecStart=/usr/bin/node /path/to/si-website/server.js 3000
Restart=always
RestartSec=3
```

### Cloudflare 隧道（cloudflared）

隧道由 **cloudflared 容器**维护（`--network host`，`--restart=always`），

```bash
docker run -d --name cloudflared --restart=always --network host \
  cloudflare/cloudflared:latest tunnel \
  --no-autoupdate --no-prechecks run --protocol http2 --token <TUNNEL_TOKEN>
```

> 💡 **大陆服务器连接 Cloudflare 边缘**：若出站到 `198.41.0.0/16:7844` 的连接被网络干扰导致隧道抖动（`Error 1033`/`502`），可通过 **mihomo 透明代理** 走海外节点中转（见下方「疑难排障」）。

## 💾 数据存储

- 所有业务数据保存在 `local-data/users.json`（已加入 `.gitignore`，不提交仓库）。
- 主要字段：
  - `users`：注册用户（邮箱 → MD5 加密密码）
  - `registerCodes`：注册码数组（后台「注册码」页管理）
  - `partList`：报名提交记录
  - `members`：社团人员名单（签到/抽奖校验依据）
  - `signin`：签到事件与记录
  - `votes`：投票配置与记录
  - `draw`：抽奖配置、参与者、中奖名单
  - `economy`：经费数据
- 开发环境与生产环境共用同一数据结构（`loadData`/`saveData` 一致）。

## 📚 API 接口一览（`server.js` / `local-api.plugin.js`）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/RegisterHandler` | POST | 注册（校验多注册码） |
| `/api/LoginHandler` | POST | 登录校验 |
| `/api/CodeHandler` | GET/POST/DELETE | 注册码管理 |
| `/api/SignUpHandler` | GET/POST/DELETE | 报名提交/列表 |
| `/api/SignUpConfigHandler` | GET/POST | 报名时间/跳转链接 |
| `/api/SigninHandler` | GET/POST | 签到 |
| `/api/DrawHandler` | GET/POST | 抽奖（参与/设奖/开奖/重置） |
| `/api/VoteHandler` | GET/POST | 投票 |
| `/api/QAHandler` | GET/POST | Q&A |
| `/api/MemberListHandler` | GET/POST/DELETE | 人员名单 |
| `/api/MemberConfigHandler` | GET/POST | 社团人数 |
| `/api/LiveConfigHandler` | GET/POST | 直播链接 |
| `/api/BlogHandler` | GET/POST | 博客 |
| `/api/DataHandler` | POST | 经费数据 |

## 📁 目录结构

```
.
├── docusaurus.config.ts      # Docusaurus 配置（导航、主题等）
├── server.js                 # 生产服务器（静态 + 全部 /api 接口）
├── local-api.plugin.js       # 开发模式 API 中间件（模拟 server.js）
├── package.json
├── build/                    # 生产构建产物
├── local-data/users.json     # 业务数据（不提交 git）
├── functions/                # Cloudflare Pages Functions（参考/迁移用）
├── blog/                     # 博客 Markdown 文章
└── src/
    ├── pages/                # 页面（index / sign_up / check_in / draw / vote / qa / backend ...）
    ├── components/
    │   ├── backend/          # 后台管理组件（各 Manager）
    │   ├── SignUpForm/       # 报名表单
    │   ├── CheckInForm/      # 签到表单
    │   ├── DrawForm/         # 抽奖表单
    │   ├── EconomyStatus/    # 经费状态
    │   └── MemberCounter/    # 成员人数
    ├── theme/                # 主题定制（Navbar 等）
    └── css/                  # 全局样式
```

## 🔧 疑难排障

### 1. 构建报 `EACCES: permission denied`

`.docusaurus` 或 `build/` 目录权限异常时：

```bash
sudo chown -R $(whoami):$(whoami) .docusaurus build
npm run build
```

### 2. 网站 `Error 1033` / `502`（Cloudflare 隧道连不上）

- 确认 `cloudflared` 容器在运行：`docker ps | grep cloudflared`
- 若隧道因大陆网络直连 Cloudflare 边缘（`198.41.0.0/16:7844`）不稳定（日志出现 `Failed to dial a quic` / `i/o timeout`）：
  1. 启动 **mihomo 透明代理**（`systemctl start mihomo`），写入订阅节点。
  2. 加载 iptables 重定向规则（`systemctl start cf-tproxy`），把出站到 CF 边缘的流量经代理转发。
  3. 重启 cloudflared：`docker restart cloudflared`。

相关服务（建议开机自启）：

```bash
systemctl enable --now mihomo     # 代理内核
systemctl enable --now cf-tproxy  # iptables 透明代理规则
```

### 3. 修改前端后页面没更新

重新构建：`npm run build`，然后确认 `server.js` 服务的是最新 `build/`。

---

## 📖 常用学习文档

#### TypeScript
- [TypeScript 中文手册](https://www.tsdev.cn/basic-types.html)
- [TypeScript 菜鸟教程](https://www.runoob.com/typescript/ts-basic-syntax.html)

#### React
- [React 中文文档](https://zh-hans.react.dev/learn)

#### CSS
- [MDN CSS 官方文档](https://developer.mozilla.org/zh-CN/docs/Learn/CSS)

#### Docusaurus
- [Docusaurus 文档](https://docusaurus.io/zh-CN/docs/)
- [Docusaurus 核心](https://docusaurus.io/zh-CN/docs/category/guides)
- [Docusaurus 配置](https://docusaurus.io/zh-CN/docs/api/docusaurus-config)
- [Docusaurus Swizzling](https://docusaurus.io/zh-CN/docs/swizzling)

#### Infima
- [Infima 文档](https://infima.dev/docs/getting-started/introduction)

#### Git
- [Git 菜鸟教程](https://www.runoob.com/git/git-tutorial.html)
- [Git 速查表](https://ndpsoftware.com/git-cheatsheet.html)（上方有中文）

## 🧩 技术栈关系

**Docusaurus（模板）** 基于 **React（框架）** 的静态网站生成器，支持使用 **TypeScript（语言）** 编写，并使用 **Infima（组件库）** 作为 CSS 框架。

---

> 📌 维护提示：修改 API 路由时，请同步更新 `server.js`（生产）与 `local-api.plugin.js`（开发），保证两处接口行为一致。
