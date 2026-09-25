// ⚠️ SECURITY WARNING（安全警示）
// 本文件为 Cloudflare Pages Functions 参考实现，**生产环境未部署**（生产由 server.js 提供 /api）。
// 注意：本实现缺少生产版 server.js 中已加入的安全校验（来源/限速/字段校验/去重/防覆盖）。
// 若将来改用 Pages/KV 部署，请先补齐同等防护，否则会重现投票刷票、报名灌水等问题。
interface Env {
  QA: KVNamespace;
}

export const onRequest: PagesFunction<Env> = async (context) => {
  if (context.request.method === "POST") {
    const body = await context.request.json();

    if (!body) {
      return new Response("Error: no request body.", { status: 400 });
    }

    if (body.timestamp) {
      await context.env.QA.put(body.timestamp, JSON.stringify(body.data));
      return new Response("Success");
    } else if (body.delete) {
      await context.env.QA.delete(body.delete);
      return new Response("Success");
    }

    return new Response("Error: unknown error", { status: 400 });
  } else if (context.request.method === "GET") {
    const url = new URL(context.request.url);
    const params = url.searchParams;
    const timestamp = params.get("timestamp");

    if (timestamp && Date.now() - parseInt(timestamp) < 10000) {
      const list = await context.env.QA.list();
      const keys = list.keys;
      const data = {};
      for (const key of keys) {
        data[key.name] = await context.env.QA.get(key.name, {
          type: "json",
        });
      }
      return new Response(JSON.stringify(data));
    }
  }
  return new Response("Error: unknown error", { status: 400 });
};
