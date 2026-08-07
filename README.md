# si-website

一个使用 [Docusaurus](https://docusaurus.io/zh-CN/) 和 [TypeScript](https://www.typescriptlang.org/zh/) 构建的网站.

## 维护指南

### 快速开始

#### 0. 安装软件

- [Git](https://git-scm.com/downloads)

- [Node.js](https://nodejs.org/zh-cn)

- [VSCode](https://code.visualstudio.com/)
  (没有中文？扩展中安装简体中文扩展即可)

#### 1. 克隆 (Clone) 仓库

建议跟随 VSCode 指引克隆项目

#### 2. 安装依赖

打开项目，在 VSCode 终端输入：

```
npm install
```

#### 3. 运行项目（开发模式）

```
npm start
```

开发模式下，`注册/登录/报名` 等接口由本地中间件 `local-api.plugin.js` 提供（数据保存在 `local-data/users.json`）。

---

## 生产部署（本地服务器 + Cloudflare Tunnel）

> 生产环境**不使用** Cloudflare Pages Functions（`functions/api/*` 仅供参考/迁移），
> 而是由本机 Node 服务 `server.js` 提供站点静态资源与全部 API 接口。

### 架构概览

```
用户 ──▶ Cloudflare（代理/隧道） ──▶ cloudflared ──▶ 本机 nginx:80 ──▶ node server.js:3000
                                                                    │
                                                                    └──▶ 数据: local-data/users.json
```

- 域名通过 **Cloudflare Tunnel**（cloudflared 容器）回源到本机。
- `nginx` 监听 80 → 反向代理到 `node server.js:3000`。
- `server.js` 同时托管 `build/` 静态文件与 `/api/*` 接口。

### 构建生产产物

```
npm run build
```

### 启动生产服务器

```bash
node server.js 3000
```

或配置 systemd 服务（见 `/etc/systemd/system/si-website.service`），设置 `WorkingDirectory`
与 `ExecStart=/usr/bin/node /path/to/server.js 3000` 即可开机自启。

### 数据存储

- 注册用户、注册码、报名、人员名单、签到、投票、经费等数据均保存在 `local-data/users.json`。
- 注册码使用 `registerCodes`（数组）字段，可在后台「注册码」页面增删。

### 接口一览（均由 `server.js` 提供）

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/RegisterHandler` | POST | 注册（校验多注册码） |
| `/api/LoginHandler` | POST | 登录校验 |
| `/api/CodeHandler` | GET/POST/DELETE | 注册码管理 |
| `/api/SignUpHandler` | GET/POST/DELETE | 报名 |
| `/api/SigninHandler` | GET/POST | 签到 |
| `/api/VoteHandler` | GET/POST | 投票 |
| `/api/QAHandler` | GET/POST | Q&A |
| `/api/MemberListHandler` | GET/POST/DELETE | 人员名单 |
| `/api/BlogHandler` | GET/POST | 博客 |
| ... | ... | 更多见 `server.js` |

---

### 你大概率需要经常用到的文档

#### TypeScript

[TypeScript 中文手册](https://www.tsdev.cn/basic-types.html)

[TypeScript 菜鸟教程](https://www.runoob.com/typescript/ts-basic-syntax.html)

#### React

[React 中文文档](https://zh-hans.react.dev/learn)

#### CSS

[MDN CSS 官方文档](https://developer.mozilla.org/zh-CN/docs/Learn/CSS)

#### Docusaurus

[Docusaurus 文档](https://docusaurus.io/zh-CN/docs/)

- [Docusaurus 核心](https://docusaurus.io/zh-CN/docs/category/guides)

- [Docusaurus 配置](https://docusaurus.io/zh-CN/docs/api/docusaurus-config)

- [Docusaurus Swizzling](https://docusaurus.io/zh-CN/docs/swizzling)

#### Infima

[Infima 文档](https://infima.dev/docs/getting-started/introduction)

#### Git

[Git 菜鸟教程](https://www.runoob.com/git/git-tutorial.html)

[Git 速查表](https://ndpsoftware.com/git-cheatsheet.html)
(上方有中文)

### 它们之间的关系？

**Docusaurus(模板)** 是一个基于 **React(框架)** 的静态网站生成器，它支持使用 **TypeScript(语言)** 编写，并使用 **Infima(组件库)** 作为 CSS 框架。
