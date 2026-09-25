// ⚠️ SECURITY WARNING（安全警示）
// 本文件为 Cloudflare Pages Functions 参考实现，**生产环境未部署**（生产由 server.js 提供 /api）。
// 注意：本实现缺少生产版 server.js 中已加入的安全校验（来源/限速/字段校验/去重/防覆盖）。
// 若将来改用 Pages/KV 部署，请先补齐同等防护，否则会重现投票刷票、报名灌水等问题。
interface Env {
  USERS: KVNamespace;
  CODE: KVNamespace;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") {
    const body = await context.request.json();

    if (!body || !body.code) {
      return new Response("Error: no request body.", { status: 400 });
    }

    // 校验注册码（支持多个注册码）
    const isValid = await isCodeValid(context.env.CODE, String(body.code));
    if (!isValid) return new Response("Error: wrong code.");

    if (!body.email || !body.password) {
      return new Response("Error: email or password missing.", { status: 400 });
    }

    await context.env.USERS.put(body.email, body.password);
    return new Response("Success");
  }
  return new Response("Error: unknown error", { status: 400 });
};

/**
 * 判断注册码是否有效。
 * 兼容旧的单注册码存储方式（存在 key = "0"），
 * 新的多注册码以 `code:<值>` 作为键存储。
 */
async function isCodeValid(codeNS: KVNamespace, code: string): Promise<boolean> {
  // 1) 新的多注册码存储方式
  const hit = await codeNS.get("code:" + code);
  if (hit !== null) return true;

  // 2) 旧的单注册码存储方式（且新方式中不存在同名 key 时）
  const legacy = await codeNS.get("0");
  if (legacy !== null && legacy === code) return true;

  return false;
}
