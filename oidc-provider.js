/**
 * OIDC Provider —— 智能信息社官网作为 OpenID Connect 身份提供商（Identity Provider）
 *
 * 让外部服务（如 OpenList）通过官网账号体系实现单点登录（SSO）。
 * 复用官网现有登录态（si_session cookie + Authorization Bearer），
 * 提供标准 OIDC Authorization Code Flow + RS256 签名 JWT。
 *
 * 启用方式（环境变量，任一为真则挂载）：
 *   OIDC_ENABLED=1
 *
 * 可选配置（环境变量）：
 *   OIDC_ISSUER           # 对外 issuer 地址，默认取请求 Host（或 SITE_URL）
 *   OIDC_CLIENT_ID        # 信任的 client_id，逗号分隔可多值，默认 "openlist"
 *   OIDC_CLIENT_SECRET    # 该 client 的 secret，默认随机生成并打印到日志
 *
 * 关键端点：
 *   GET  /.well-known/openid-configuration    # OIDC Discovery
 *   GET  /.well-known/jwks.json               # JWKS（RS256 公钥）
 *   GET  /oauth/cert.pem                      # X.509 证书 PEM（供 OpenList sso_jwt_public_key 粘贴）
 *   GET  /oauth/authorize                     # 授权端点（检查登录态，未登录跳官网登录页）
 *   POST /oauth/token                         # code -> access_token（RS256 JWT）
 *   GET  /oauth/userinfo                      # 用户信息（Bearer token）
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const DIRECTORY = __dirname;
const KEYS_FILE = path.join(DIRECTORY, "local-data", "oidc-keys.json");

let enabled =
  process.env.OIDC_ENABLED &&
  /^(1|true|yes|on)$/i.test(String(process.env.OIDC_ENABLED).trim());
const CLIENT_ID = process.env.OIDC_CLIENT_ID || "openlist";
let CLIENT_SECRET = process.env.OIDC_CLIENT_SECRET || ""; // 惰性：ensureKeys 时生成并持久化
const ISSUER_ENV = process.env.OIDC_ISSUER || "";
const TOKEN_TTL = 60 * 60; // access token 有效期 1 小时
const CODE_TTL = 10 * 60; // authorization code 有效期 10 分钟

// 常见 OpenList 回调地址（宽松匹配；生产可收紧）
const DEFAULT_REDIRECTS = [
  /^https?:\/\/[^/]+\/api\/auth\/sso_callback(\?.*)?$/,
  /^https?:\/\/localhost[^/]*\/api\/auth\/sso_callback(\?.*)?$/,
  /^https?:\/\/127\.0\.0\.1[^/]*\/api\/auth\/sso_callback(\?.*)?$/,
];

const CLIENT_ID_ARR = String(CLIENT_ID)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// 比较 redirect_uri 是否同源同路径（忽略 query 参数差异，兼容 OpenList 的 method 参数）
function sameRedirect(a, b) {
  const base = (u) => {
    try {
      const p = new URL(u);
      p.search = "";
      p.hash = "";
      return p.toString().replace(/\/+$/, "");
    } catch (e) {
      return String(u);
    }
  };
  return base(a) === base(b);
}

let RSA = null; // { priv: KeyObject, certPem, publicKeyPem }

// ---- 密钥管理：用 openssl 生成 RSA + 自签 X.509 证书（DER 由 openssl 负责）----
function ensureKeys() {
  if (RSA) return RSA;
  // 确保 client_secret 已初始化（环境变量 > 持久化 > 随机生成），并持久化
  if (!CLIENT_SECRET) {
    const savedSecret = fs.existsSync(KEYS_FILE)
      ? (() => {
          try {
            return JSON.parse(fs.readFileSync(KEYS_FILE, "utf-8")).clientSecret;
          } catch (e) {
            return null;
          }
        })()
      : null;
    CLIENT_SECRET =
      savedSecret || crypto.randomBytes(24).toString("hex");
  }
  if (fs.existsSync(KEYS_FILE)) {
    try {
      const raw = JSON.parse(fs.readFileSync(KEYS_FILE, "utf-8"));
      if (raw.privateKey && raw.certPem && raw.publicKeyPem) {
        const priv = crypto.createPrivateKey(raw.privateKey);
        RSA = { priv, certPem: raw.certPem, publicKeyPem: raw.publicKeyPem };
        // 将新生成的 secret 写回
        if (raw.clientSecret !== CLIENT_SECRET) {
          raw.clientSecret = CLIENT_SECRET;
          try {
            fs.writeFileSync(KEYS_FILE, JSON.stringify(raw, null, 2), "utf-8");
          } catch (e) {}
        }
        return RSA;
      }
    } catch (e) {
      /* 重新生成 */
    }
  }
  // 用 openssl 生成 RSA 2048 私钥 + 自签 X.509 证书（临时文件方案，兼容 OpenSSL 1.x/3.x）
  const dir = path.dirname(KEYS_FILE);
  const tmpKey = path.join(dir, ".oidc-tmp-key.pem");
  const tmpCert = path.join(dir, ".oidc-tmp-cert.pem");
  fs.mkdirSync(dir, { recursive: true });
  execSync(`openssl genrsa -out ${tmpKey} 2048 2>/dev/null`);
  execSync(
    `openssl req -new -x509 -key ${tmpKey} -out ${tmpCert} -days 3650 -sha256 -subj "/CN=si-hzyz-oidc/O=SI Website" 2>/dev/null`
  );
  const privPem = fs.readFileSync(tmpKey, "utf-8");
  const certPem = fs.readFileSync(tmpCert, "utf-8");
  const pubPem = execSync(`openssl pkey -in ${tmpKey} -pubout 2>/dev/null`, {
    encoding: "utf-8",
  });
  try {
    fs.unlinkSync(tmpKey);
    fs.unlinkSync(tmpCert);
  } catch (e) {}
  RSA = { priv: crypto.createPrivateKey(privPem), certPem, publicKeyPem: pubPem };
  try {
    fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true });
    fs.writeFileSync(
      KEYS_FILE,
      JSON.stringify({ privateKey: privPem, certPem: certPem, publicKeyPem: pubPem, clientSecret: CLIENT_SECRET }, null, 2),
      "utf-8"
    );
  } catch (e) {}
  return RSA;
}

// ---- RS256 JWT 签名（标准 JWT）----
function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function signJWT(payload, ttlSeconds, { kid = "oidc" } = {}) {
  const header = { alg: "RS256", typ: "JWT", kid };
  const now = Math.floor(Date.now() / 1000);
  const body = Object.assign({}, payload, {
    iat: now,
    exp: now + ttlSeconds,
    iss: currentIssuer(),
    aud: CLIENT_ID_ARR[0] || "openlist",
  });
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(body));
  const data = `${h}.${p}`;
  const sig = crypto.sign("sha256", Buffer.from(data), RSA.priv).toString("base64url");
  return `${data}.${sig}`;
}

let _issuerCache = "";
function currentIssuer(req) {
  if (ISSUER_ENV) return ISSUER_ENV;
  if (req) {
    const proto = req.headers["x-forwarded-proto"] || "http";
    const host = req.headers.host || "localhost";
    return `${proto}://${host}`;
  }
  if (_issuerCache) return _issuerCache;
  return "http://localhost";
}

// 用于拼接端点 URL 的基础地址（去掉尾斜杠）
function endpointBase(req) {
  return String(currentIssuer(req)).replace(/\/+$/, "");
}

// ---- 授权码/令牌存储（内存）----
const codes = new Map();
const tokens = new Map();

function genCode() {
  return crypto.randomBytes(24).toString("base64url");
}
function genToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function redirectAllowed(uri) {
  if (!uri) return false;
  for (const r of DEFAULT_REDIRECTS) {
    if (r.test(uri)) return true;
  }
  return false;
}

function timingSafe(a, b) {
  const ba = Buffer.from(String(a || ""));
  const bb = Buffer.from(String(b || ""));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}
function isValidClient(clientId, clientSecret) {
  if (!clientId) return false;
  const okId = CLIENT_ID_ARR.includes(String(clientId));
  if (!okId) return false;
  // 有 client_secret 时必须校验；无 secret（public client）仅校验 id
  if (!clientSecret) return true;
  return timingSafe(clientSecret, CLIENT_SECRET);
}

let helpers = null;
function getUserEmail(req) {
  if (!helpers || !helpers.getSessionEmail) return null;
  return helpers.getSessionEmail(req);
}

function discoveryDoc(req) {
  const iss = currentIssuer(req);
  const base = endpointBase(req);
  return {
    issuer: iss,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    userinfo_endpoint: `${base}/oauth/userinfo`,
    jwks_uri: `${base}/.well-known/jwks.json`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["RS256"],
    scopes_supported: ["openid", "profile", "email"],
    token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    claims_supported: ["iss", "sub", "aud", "exp", "iat", "email", "email_verified", "name", "preferred_username", "nickname", "role"],
  };
}

function buildUserInfo(email, user) {
  const nick = (user && user.nick) || "";
  return {
    sub: email,
    email: email,
    email_verified: true,
    name: nick || email,
    preferred_username: nick || String(email).split("@")[0],
    nickname: nick || String(email).split("@")[0],
    role: (user && user.role) || "user",
  };
}

function parseFormBody(req) {
  let body;
  if (typeof req.body === "string") {
    // server.js 用 bodyParser.text，body 是原始字符串
    const raw = req.body;
    // 优先尝试 JSON
    const trimmed = raw.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      try {
        body = JSON.parse(trimmed);
      } catch (e) {
        body = {};
      }
    } else {
      // application/x-www-form-urlencoded
      body = {};
      for (const pair of trimmed.split("&")) {
        if (!pair) continue;
        const eq = pair.indexOf("=");
        const k = eq >= 0 ? pair.slice(0, eq) : pair;
        const v = eq >= 0 ? pair.slice(eq + 1) : "";
        try {
          body[decodeURIComponent(k)] = decodeURIComponent(v);
        } catch (e) {
          body[k] = v;
        }
      }
    }
  } else if (req.body && typeof req.body === "object") {
    body = req.body;
  } else {
    body = {};
  }
  // 合并 query（兜底，兼容客户端用 query 传参）
  for (const k of Object.keys(req.query || {})) {
    if (body[k] === undefined) body[k] = req.query[k];
  }
  return body;
}

// ---- 注册路由 ----
function register(app, helper) {
  helpers = helper;
  if (!enabled) return;
  ensureKeys();

  app.get("/.well-known/openid-configuration", (req, res) => {
    res.set("Cache-Control", "no-store").json(discoveryDoc(req));
  });
  app.get("/oauth/.well-known/openid-configuration", (req, res) => {
    res.set("Cache-Control", "no-store").json(discoveryDoc(req));
  });

  app.get("/.well-known/jwks.json", (req, res) => {
    const pub = crypto.createPublicKey(RSA.publicKeyPem);
    const jwk = pub.export({ format: "jwk" });
    res.json({
      keys: [{ kty: jwk.kty, kid: "oidc", use: "sig", alg: "RS256", n: jwk.n, e: jwk.e }],
    });
  });

  // X.509 证书 PEM（供 OpenList sso_jwt_public_key 粘贴）
  app.get("/oauth/cert.pem", (req, res) => {
    res.set("Content-Type", "application/x-pem-file");
    res.set("Content-Disposition", 'inline; filename="oidc-cert.pem"');
    res.send(RSA.certPem);
  });

  // 授权端点
  app.get("/oauth/authorize", (req, res) => {
    const { client_id, redirect_uri, response_type, state, scope, nonce } = req.query;
    const email = getUserEmail(req);

    const fail = (msg) => {
      if (state !== undefined && redirect_uri) {
        const sep = redirect_uri.includes("?") ? "&" : "?";
        return res.redirect(
          `${redirect_uri}${sep}error=access_denied&error_description=${encodeURIComponent(msg)}&state=${encodeURIComponent(state)}`
        );
      }
      return res.status(400).send(`Error: ${msg}`);
    };

    if (response_type !== "code") return fail("unsupported response_type");
    if (!isValidClient(client_id, "")) return fail("invalid client_id");
    if (!redirectAllowed(redirect_uri)) return fail("invalid redirect_uri");

    if (!email) {
      // 未登录：跳官网登录页，登录后回跳继续授权
      const backParams = new URLSearchParams({
        client_id: client_id || CLIENT_ID_ARR[0],
        redirect_uri: redirect_uri,
        response_type: "code",
      });
      if (state !== undefined) backParams.set("state", state);
      if (nonce !== undefined) backParams.set("nonce", nonce);
      const back = encodeURIComponent(`/oauth/authorize?${backParams.toString()}`);
      return res.redirect(`/?or_login=1&redirect=${back}`);
    }

    const code = genCode();
    codes.set(code, {
      client_id: client_id || CLIENT_ID_ARR[0],
      redirect_uri,
      email,
      state: state !== undefined ? String(state) : null,
      nonce: nonce !== undefined ? String(nonce) : null,
      expires: Date.now() + CODE_TTL * 1000,
    });
    const sep = redirect_uri.includes("?") ? "&" : "?";
    let loc = `${redirect_uri}${sep}code=${encodeURIComponent(code)}`;
    if (state !== undefined) loc += `&state=${encodeURIComponent(state)}`;
    return res.redirect(loc);
  });

  // 令牌端点
  app.post("/oauth/token", (req, res) => {
    const body = parseFormBody(req);
    const code = body.code || (req.query && req.query.code);
    const grant_type = body.grant_type || "authorization_code";
    const redirect_uri = body.redirect_uri || "";
    let clientId = body.client_id;
    let clientSecret = body.client_secret;
    const authHeader = req.headers.authorization || "";
    if (authHeader.startsWith("Basic ")) {
      try {
        const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
        const idx = decoded.indexOf(":");
        if (idx >= 0) {
          clientId = clientId || decoded.slice(0, idx);
          clientSecret = clientSecret || decoded.slice(idx + 1);
        }
      } catch (e) {}
    }

    if (grant_type !== "authorization_code") {
      return res.status(400).json({ error: "unsupported_grant_type" });
    }
    const entry = codes.get(String(code));
    if (!entry || entry.expires < Date.now()) {
      return res.status(400).json({ error: "invalid_grant", error_description: "invalid or expired code" });
    }
    if (!isValidClient(clientId, clientSecret)) {
      return res.status(400).json({ error: "invalid_client" });
    }
    if (entry.redirect_uri && redirect_uri && !sameRedirect(entry.redirect_uri, redirect_uri)) {
      return res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
    }
    codes.delete(String(code));

    const data = helpers && helpers.loadData ? helpers.loadData() : { users: {} };
    const user = (data.users && data.users[entry.email]) || null;
    const info = buildUserInfo(entry.email, user);

    const accessToken = signJWT(Object.assign({}, info), TOKEN_TTL, { kid: "oidc" });
    const id_token = signJWT(
      {
        sub: info.sub,
        name: info.name,
        email: info.email,
        email_verified: true,
        preferred_username: info.preferred_username,
        ...(entry.nonce ? { nonce: entry.nonce } : {}),
      },
      TOKEN_TTL,
      { kid: "oidc" }
    );

    const opaque = genToken();
    tokens.set(opaque, {
      email: entry.email,
      scopes: ["openid", "profile", "email"],
      expires: Date.now() + TOKEN_TTL * 1000,
    });

    res.json({
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: TOKEN_TTL,
      id_token: id_token,
      scope: "openid profile email",
    });
  });

  // 用户信息端点
  app.get("/oauth/userinfo", (req, res) => {
    const auth = req.headers.authorization || "";
    let token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
    let email = null;
    if (token.startsWith("eyJ")) {
      try {
        const parts = token.split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf-8"));
          const data = `${parts[0]}.${parts[1]}`;
          const sig = Buffer.from(parts[2], "base64url");
          const ok = crypto.verify(
            "sha256",
            Buffer.from(data),
            crypto.createPublicKey(RSA.publicKeyPem),
            sig
          );
          if (ok && payload.exp * 1000 > Date.now()) email = payload.sub;
        }
      } catch (e) {}
    } else {
      const entry = tokens.get(token);
      if (entry && entry.expires > Date.now()) email = entry.email;
    }
    if (!email) return res.status(401).json({ error: "invalid_token" });
    const data = helpers && helpers.loadData ? helpers.loadData() : { users: {} };
    const user = (data.users && data.users[email]) || null;
    return res.json(buildUserInfo(email, user));
  });

  console.log(
    `[OIDC] 已启用。 issuer=${currentIssuer()}  client_id=${CLIENT_ID_ARR.join(",")}  client_secret=${CLIENT_SECRET}`
  );
  console.log(`[OIDC] 证书端点: /oauth/cert.pem  （OpenList sso_jwt_public_key 填入该 PEM 内容）`);
}

module.exports = { register, forceEnabled: (v) => (enabled = v) };
