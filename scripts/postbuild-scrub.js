#!/usr/bin/env node
/**
 * 构建后脱敏（postbuild）
 *  1) 移除构建机/本机绝对路径（只删「已知的本项目与构建机前缀」，不碰文档里的示例路径）
 *  2) 移除 Docusaurus 版本指纹 meta
 * 由 package.json 的 build 脚本自动调用；也可手动执行：node scripts/postbuild-scrub.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const BUILD_DIR = path.join(ROOT, "build");
const EXTS = new Set([".js", ".mjs", ".html", ".htm", ".css", ".json", ".xml", ".txt", ".map"]);

// 需要脱敏的前缀（长前缀在前，避免被短前缀抢先匹配）
const SENSITIVE_PREFIXES = [
  ROOT + path.sep,
  ROOT + "/",
  path.dirname(ROOT) + path.sep, // 工作空间根目录
  path.dirname(ROOT) + "/",
  "/mnt/btrfs-workspace/ws-398ab6/", // 历史构建机残留
  "/mnt/btrfs-workspace/",
];

function scrubText(text) {
  let out = text;
  // 1) 绝对路径 -> 相对片段（例如 /xxx/si-website/server.js -> server.js）
  for (const p of SENSITIVE_PREFIXES) {
    while (out.indexOf(p) !== -1) out = out.split(p).join("");
  }
  // 2) 兜底：任何以 si-website / si-website-4000 结尾的绝对路径前缀
  out = out.replace(/\/[A-Za-z0-9._/-]*\/(si-website-4000|si-website)\//g, "$1/");
  // 3) 移除 Docusaurus 版本指纹（两种属性顺序都覆盖）
  out = out.replace(/<meta[^>]*name="generator"[^>]*content="Docusaurus[^"]*"[^>]*>/gi, "");
  out = out.replace(/<meta[^>]*content="Docusaurus[^"]*"[^>]*name="generator"[^>]*>/gi, "");
  return out;
}

let total = 0;
let changed = 0;

function walk(dir) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
    } else if (EXTS.has(path.extname(e.name).toLowerCase())) {
      let raw;
      try {
        raw = fs.readFileSync(full, "utf-8");
      } catch (err) {
        continue;
      }
      const out = scrubText(raw);
      if (out !== raw) {
        fs.writeFileSync(full, out, "utf-8");
        changed++;
      }
      total++;
    }
  }
}

if (!fs.existsSync(BUILD_DIR)) {
  console.error("[postbuild-scrub] 未找到 build 目录，跳过");
  process.exit(0);
}
walk(BUILD_DIR);

// 3) sitemap 收尾：剔除后台页（与 robots.txt 的 Disallow: /backend/ 一致）+ 去重
(function scrubSitemap() {
  const sm = path.join(BUILD_DIR, "sitemap.xml");
  if (!fs.existsSync(sm)) return;
  let xml;
  try {
    xml = fs.readFileSync(sm, "utf-8");
  } catch (e) {
    return;
  }
  const before = (xml.match(/<url>/g) || []).length;
  const head = xml.slice(0, xml.indexOf("<url>"));
  const tail = xml.slice(xml.lastIndexOf("</url>") + "</url>".length);
  const blocks = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
  const seen = new Set();
  const kept = [];
  for (const b of blocks) {
    const m = b.match(/<loc>([^<]*)<\/loc>/);
    if (!m) continue;
    const url = m[1];
    let p = "/";
    try {
      p = new URL(url).pathname;
    } catch (e) {}
    if (/^\/backend(\/|$)/.test(p)) continue; // 后台入口不进 sitemap
    if (seen.has(url)) continue; // 去重（同 slug 的重复页面）
    seen.add(url);
    kept.push(b);
  }
  const out = head + kept.join("") + tail;
  if (out !== xml) {
    fs.writeFileSync(sm, out, "utf-8");
    console.log(`[postbuild-scrub] sitemap: ${before} -> ${kept.length} 条（剔除后台页/重复页）`);
  }
})();

// 残留检查：只匹配「纯 ASCII 的绝对路径段」，避免误报文档里的中文示例路径
const residual = /\/(?:home|mnt|Users|root|opt|var)\/[A-Za-z0-9._-]+/;
const leftovers = [];
(function scan(dir) {
  let ents = [];
  try {
    ents = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) scan(full);
    else if (EXTS.has(path.extname(e.name).toLowerCase())) {
      try {
        if (residual.test(fs.readFileSync(full, "utf-8"))) leftovers.push(path.relative(ROOT, full));
      } catch (err) {}
    }
  }
})(BUILD_DIR);

console.log(`[postbuild-scrub] 扫描 ${total} 个文件，脱敏 ${changed} 个`);
if (leftovers.length) {
  console.warn(`[postbuild-scrub] 警告：仍有文件包含绝对路径 → ${leftovers.slice(0, 10).join(", ")}`);
} else {
  console.log("[postbuild-scrub] 未发现残留绝对路径 / 版本指纹");
}
