interface Env {
  CODE: KVNamespace;
}

const CODE_PREFIX = "code:";

export const onRequest: PagesFunction<Env> = async (context) => {
  const method = context.request.method;

  if (method === "POST") {
    // 添加注册码
    const body = await context.request.json();
    if (!body || !body.codes) {
      return new Response(JSON.stringify({ msg: "Error: no codes." }), {
        status: 400,
      });
    }

    const input = Array.isArray(body.codes) ? body.codes : [body.codes];
    let added = 0;
    let skipped = 0;
    const skippedCodes: string[] = [];

    for (const raw of input) {
      const code = String(raw).trim();
      if (!code) continue;
      if (await (await context.env.CODE.get(CODE_PREFIX + code)) !== null) {
        skipped++;
        skippedCodes.push(code);
        continue;
      }
      await context.env.CODE.put(CODE_PREFIX + code, "1");
      added++;
    }

    return new Response(
      JSON.stringify({ msg: "Success", added, skipped, skippedCodes })
    );
  } else if (method === "GET") {
    // 列出所有注册码
    const list = await context.env.CODE.list();
    const codes: string[] = [];
    for (const key of list.keys) {
      if (key.name.startsWith(CODE_PREFIX)) {
        codes.push(key.name.slice(CODE_PREFIX.length));
      }
    }
    // 忽略旧的单注册码 key "0"（保证一致、可管理，不纳入多注册码列表）
    return new Response(JSON.stringify({ codes }));
  } else if (method === "DELETE") {
    // 删除注册码
    const body = await context.request.json();
    if (!body || !body.codes) {
      return new Response(JSON.stringify({ msg: "Error: no codes." }), {
        status: 400,
      });
    }

    const input = Array.isArray(body.codes) ? body.codes : [body.codes];
    let removed = 0;

    for (const raw of input) {
      const code = String(raw).trim();
      if (!code) continue;
      await context.env.CODE.delete(CODE_PREFIX + code);
      removed++;
    }

    return new Response(
      JSON.stringify({ msg: "Success", removed })
    );
  }

  return new Response(JSON.stringify({ msg: "Error: unknown error" }), {
    status: 400,
  });
};
