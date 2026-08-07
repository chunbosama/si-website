import clsx from "clsx";
import { useEffect, useState } from "react";

import styles from "./index.module.css";

async function getCodes() {
  try {
    const resp = await fetch("/api/CodeHandler?t=" + Date.now());
    if (resp.ok) {
      const data = await resp.json();
      return Array.isArray(data.codes) ? data.codes : [];
    }
  } catch (e) {}
  return [];
}

async function addCodes(codes: string[]) {
  const resp = await fetch("/api/CodeHandler", {
    method: "POST",
    body: JSON.stringify({ codes }),
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, data: JSON.parse(text) };
  } catch (e) {
    return { ok: resp.ok, data: { msg: text } };
  }
}

async function deleteCodes(codes: string[]) {
  const resp = await fetch("/api/CodeHandler", {
    method: "DELETE",
    body: JSON.stringify({ codes }),
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, data: JSON.parse(text) };
  } catch (e) {
    return { ok: resp.ok, data: { msg: text } };
  }
}

export default function CodeManager() {
  const [codes, setCodes] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [singleInput, setSingleInput] = useState("");
  const [batchText, setBatchText] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState("");
  const [msgError, setMsgError] = useState(false);
  const [busy, setBusy] = useState(false); // 0 默认 1 处理中

  useEffect(() => {
    refresh();
  }, []);

  const refresh = async () => {
    setCodes(await getCodes());
    setSelected(new Set());
    setLoaded(true);
  };

  const collectCodes = (): string[] => {
    const out: string[] = [];
    if (singleInput.trim()) {
      out.push(
        ...singleInput
          .split(/[\n,，\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
    }
    if (batchText.trim()) {
      out.push(
        ...batchText
          .split(/[\n,，]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
    }
    // 去重
    return Array.from(new Set(out));
  };

  const showMsg = (text: string, error = false) => {
    setMsg(text);
    setMsgError(error);
  };

  const handleAdd = async () => {
    const list = collectCodes();
    if (list.length === 0) return;
    setBusy(true);
    showMsg("");
    const r = await addCodes(list);
    if (r.ok) {
      const d = r.data || {};
      const skipped = d.skipped || 0;
      showMsg(
        `已添加 ${d.added} 个注册码` + (skipped > 0 ? `，跳过重复 ${skipped} 个` : "")
      );
      setSingleInput("");
      setBatchText("");
      await refresh();
    } else {
      showMsg(String((r.data && r.data.msg) || "添加失败"), true);
    }
    setBusy(false);
  };

  const targetCodes = (): string[] => {
    const out: string[] = [];
    codes.forEach((c, i) => {
      if (selected.has(i)) out.push(c);
    });
    return out;
  };

  const handleDelete = async () => {
    const list = targetCodes();
    if (list.length === 0) return;
    if (!confirm(`确定删除选中的 ${list.length} 个注册码吗？\n` + list.join("、"))) return;
    setBusy(true);
    showMsg("");
    const r = await deleteCodes(list);
    if (r.ok) {
      const d = r.data || {};
      showMsg(`已删除 ${d.removed} 个注册码`);
    } else {
      showMsg(String((r.data && r.data.msg) || "删除失败"), true);
    }
    await refresh();
    setBusy(false);
  };

  const handleDeleteOne = async (code: string, idx: number) => {
    if (!confirm(`确定删除注册码「${code}」吗？`)) return;
    setBusy(true);
    showMsg("");
    const r = await deleteCodes([code]);
    if (r.ok) {
      const d = r.data || {};
      showMsg(`已删除「${code}」`);
    } else {
      showMsg(String((r.data && r.data.msg) || "删除失败"), true);
    }
    await refresh();
    setBusy(false);
  };

  const toggleSelect = (idx: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => {
      return prev.size === codes.length
        ? new Set()
        : new Set(codes.map((_, i) => i));
    });
  };

  const canAdd = collectCodes().length > 0;

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <div className={styles.title}>注册码管理</div>
      </div>

      <div className={styles.listBox}>
        <div className={styles.configLabel}>已注册码（{codes.length} 个）</div>
        <div className={styles.configHint}>
          新用户注册时，输入的注册码需与此列表中的任意一个匹配。
        </div>

        {selected.size > 0 && (
          <div className={styles.batchBar}>
            已选 {selected.size} 个
            <button
              className={clsx("button button--sm button--danger", styles.smallBtn)}
              disabled={busy}
              onClick={handleDelete}>
              删除选中
            </button>
          </div>
        )}

        <table className={styles.table}>
          <thead className={styles.tableHead}>
            <tr className={styles.tableRow}>
              <th scope="col">
                <input
                  type="checkbox"
                  checked={codes.length > 0 && selected.size === codes.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th scope="col">#</th>
              <th scope="col">注册码</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody className={styles.tableBody}>
            {!loaded && (
              <tr className={styles.tableRow}>
                <td colSpan={4}>加载中…</td>
              </tr>
            )}
            {loaded && codes.length === 0 && (
              <tr className={styles.tableRow}>
                <td colSpan={4}>暂无注册码</td>
              </tr>
            )}
            {codes.map((code, i) => (
              <tr
                className={clsx(styles.tableRow, selected.has(i) && styles.rowSelected)}
                key={code + "_" + i}>
                <td>
                  <input
                    type="checkbox"
                    checked={selected.has(i)}
                    onChange={() => toggleSelect(i)}
                  />
                </td>
                <th scope="row">{i + 1}</th>
                <td className={styles.codeCell}>{code}</td>
                <td>
                  <button
                    className={clsx("button button--sm button--secondary", styles.smallBtn)}
                    disabled={busy}
                    onClick={() => handleDeleteOne(code, i)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 添加区域 */}
        <div className={styles.addBox}>
          <div className={styles.addLabel}>添加注册码（支持单个或多个，用逗号/空格分隔）</div>
          <input
            className={styles.input}
            type="text"
            placeholder="例如：ABC123"
            value={singleInput}
            onChange={(e) => setSingleInput(e.target.value)}
          />
          <div className={styles.addLabel}>批量添加（每行一个）：</div>
          <textarea
            className={styles.textarea}
            rows={4}
            placeholder={"CODE-001\nCODE-002\nCODE-003"}
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
          />
          <button
            className={clsx("button button--primary", styles.uploadButton)}
            disabled={!canAdd || busy}
            onClick={handleAdd}>
            {busy ? "处理中…" : "添加"}
          </button>
          {msg && (
            <div className={msgError ? styles.addMsgError : styles.addMsg}>
              {msg}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
