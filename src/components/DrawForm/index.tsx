import clsx from "clsx";
import { useEffect, useState } from "react";

import styles from "./index.module.css";

async function getDrawState() {
  try {
    const resp = await fetch("/api/DrawHandler?get=state&t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return { active: false, config: [], participants: [], results: [] };
}

export default function DrawForm() {
  const [name, setName] = useState("");
  const [active, setActive] = useState(false);
  const [config, setConfig] = useState([]);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState(0); // 0=默认 1=提交中 2=成功 3=失败
  const [msg, setMsg] = useState("");

  const statusText = {
    0: "参与抽奖",
    1: "提交中…",
    2: "参与成功",
    3: "重试",
  };

  useEffect(() => {
    getDrawState().then((r) => {
      setActive(r.active);
      setConfig(Array.isArray(r.config) ? r.config : []);
      setResults(Array.isArray(r.results) ? r.results : []);
    });
  }, []);

  const doDraw = async () => {
    if (!name.trim()) return;
    setStatus(1);
    setMsg("");
    const resp = await fetch("/api/DrawHandler", {
      method: "POST",
      body: JSON.stringify({ name: name.trim(), participate: true }),
    });
    const text = await resp.text();
    if (resp.ok) {
      setStatus(2);
      setMsg(text.replace("Success", "已参与抽奖，祝你好运！"));
    } else {
      setStatus(3);
      setMsg(text.replace("Error: ", "") || "参与失败");
    }
  };

  const hasWinners = results.length > 0;

  return (
    <div className={clsx("card shadow--md", styles.card)}>
      <div className={styles.title}>🎁 幸运抽奖</div>
      {active ? (
        <>
          {config.length > 0 && (
            <div className={styles.prizes}>
              {config.map((p, i) => (
                <span className={styles.prize} key={i}>
                  {p.name} ×{p.count}
                </span>
              ))}
            </div>
          )}

          <div className={styles.composedInput}>
            <label htmlFor="name">名字:</label>
            <input
              className={styles.input}
              type="text"
              id="name"
              placeholder="请输入你的名字（须在人员名单内）"
              value={name}
              disabled={status === 1 || status === 2}
              onChange={(e) => {
                setName(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  (e.target as HTMLInputElement)?.blur();
                  document.getElementById("submit")?.click();
                }
              }}
            />
          </div>
          <button
            className={clsx("button button--primary", styles.submitButton)}
            id="submit"
            type="submit"
            disabled={name.trim().length === 0 || status === 1 || status === 2}
            onClick={doDraw}>
            {statusText[status]}
          </button>
        </>
      ) : (
        <div className={styles.closed}>
          <b>⏸ 当前没有进行中的抽奖</b>
        </div>
      )}

      {msg && <div className={styles.msg}>{msg}</div>}

      {hasWinners && (
        <div className={styles.results}>
          <div className={styles.resultsTitle}>🏆 本轮中奖名单</div>
          {results.map((r, i) => (
            <div className={styles.resultRow} key={i}>
              <span className={styles.resultPrize}>{r.prize}</span>
              <span className={styles.resultWinners}>
                {(r.winners || []).join("、") || "—"}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
