// ⚠️ SECURITY WARNING（安全警示）
// 本文件为 Cloudflare Pages Functions 参考实现，**生产环境未部署**（生产由 server.js 提供 /api）。
// 注意：本实现缺少生产版 server.js 中已加入的安全校验（来源/限速/字段校验/去重/防覆盖）。
// 若将来改用 Pages/KV 部署，请先补齐同等防护，否则会重现投票刷票、报名灌水等问题。
interface Env {
  USERS: KVNamespace;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") {
    const body = await context.request.json();

    if (!body && !body.email) {
      return new Response("Error: no request body.", { status: 400 });
    }

    return new Response(await context.env.USERS.get(body.email));
  }
  return new Response("Error: unknown error", { status: 400 });
};
