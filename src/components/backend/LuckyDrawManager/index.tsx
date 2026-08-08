import clsx from "clsx";
import { useEffect, useState } from "react";

import styles from "./index.module.css";

async function getState() {
  try {
    const resp = await fetch("/api/DrawHandler?get=state&t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return { active: false, config: [], participants: [], results: [], history: [] };
}

async function apiPost(body: any) {
  const resp = await fetch("/api/DrawHandler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, data: JSON.parse(text) };
  } catch (e) {
    return { ok: resp.ok, data: { msg: text } };
  }
}

export default function LuckyDrawManager() {
  const [active, setActive] = useState(false);
  const [config, setConfig] = useState<{ name: string; count: number }[]>([
    { name: "一等奖", count: 1 },
    { name: "二等奖", count: 2 },
    { name: "三等奖", count: 3 },
  ]);
  const [participants, setParticipants] = useState<string[]>([]);
  const [results, setResults] = useState<{ prize: string; winners: string[] }[]>(
    []
  );
  const [history, setHistory] = useState<
    { time: number; results: { prize: string; winners: string[] }[] }[]
  >([]);
  const [msg, setMsg] = useState("");
  const [msgError, setMsgError] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    refresh();
  }, []);

  const refresh = async () => {
    const s = await getState();
    setActive(s.active);
    setConfig(Array.isArray(s.config) ? s.config : []);
    setParticipants(Array.isArray(s.participants) ? s.participants : []);
    setResults(Array.isArray(s.results) ? s.results : []);
    setHistory(Array.isArray(s.history) ? s.history : []);
  };

  const show = (t: string, err = false) => {
    setMsg(t);
    setMsgError(err);
  };

  // 保存奖项配置
  const saveConfig = async () => {
    const valid = config.filter((p) => p.name.trim() && Number(p.count) > 0);
    if (valid.length === 0) return show("请至少配置一个有效奖项", true);
    setBusy(true);
    const r = await apiPost({ saveConfig: valid });
    show(r.ok ? "奖项配置已保存" : String(r.data.msg || "保存失败"), !r.ok);
    if (r.ok) await refresh();
    setBusy(false);
  };

  // 添加/删除奖项行
  const addPrize = () =>
    setConfig([...config, { name: "", count: 1 }]);
  const updatePrize = (i: number, patch: any) =>
    setConfig(config.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removePrize = (i: number) =>
    setConfig(config.filter((_, idx) => idx !== i));

  // 开放/关闭参与
  const toggleActive = async () => {
    setBusy(true);
    const r = await apiPost({ setActive: !active });
    show(r.ok ? (active ? "已关闭参与" : "已开放参与") : String(r.data.msg || "操作失败"), !r.ok);
    if (r.ok) await refresh();
    setBusy(false);
  };

  // 清空参与者（重新开局参与名单）
  const clearParticipants = async () => {
    if (!confirm("确定清空所有参与者吗？")) return;
    setBusy(true);
    const r = await apiPost({ clearParticipants: true });
    show(r.ok ? "已清空参与者" : String(r.data.msg || "操作失败"), !r.ok);
    if (r.ok) await refresh();
    setBusy(false);
  };

  // 执行抽奖
  const execDraw = async () => {
    const total = config.reduce((s, p) => s + (Number(p.count) || 0), 0);
    if (total <= 0) return show("请先配置奖项", true);
    if (participants.length === 0) return show("暂无可参与抽奖的人", true);
    if (results.length > 0 && !confirm("已存在中奖名单，重新抽奖将覆盖，确定继续？")) return;
    if (!confirm(`将抽取 ${total} 人中奖，确定开始抽奖吗？`))
      return;
    setBusy(true);
    const r = await apiPost({ execDraw: true });
    if (r.ok) {
      show("抽奖完成！");
    } else {
      show(String(r.data.msg || "抽奖失败"), true);
    }
    await refresh();
    setBusy(false);
  };

  // 重置整轮抽奖（清空参与者 + 中奖名单）
  const resetRound = async () => {
    if (!confirm("重置将清空所有参与者与中奖名单，确定吗？")) return;
    setBusy(true);
    const r = await apiPost({ reset: true });
    show(r.ok ? "已重置本轮抽奖" : String(r.data.msg || "操作失败"), !r.ok);
    if (r.ok) await refresh();
    setBusy(false);
  };

  // 清空中奖公示历史
  const clearHistory = async () => {
    if (!confirm("确定清空全部中奖公示历史吗？此操作不可恢复。")) return;
    setBusy(true);
    const r = await apiPost({ clearHistory: true });
    show(r.ok ? "已清空中奖公示" : String(r.data.msg || "操作失败"), !r.ok);
    if (r.ok) await refresh();
    setBusy(false);
  };

  // 编辑/删除历史公示状态
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editRows, setEditRows] = useState<
    { prize: string; winners: string }[]
  >([]);

  const startEdit = (hi: number) => {
    setEditingIdx(hi);
    setEditRows(
      (history[hi].results || []).map((r) => ({
        prize: r.prize,
        winners: (r.winners || []).join("、"),
      }))
    );
  };

  const cancelEdit = () => {
    setEditingIdx(null);
    setEditRows([]);
  };

  const addEditRow = () => setEditRows([...editRows, { prize: "", winners: "" }]);
  const updateEditRow = (i: number, patch: any) =>
    setEditRows(editRows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeEditRow = (i: number) =>
    setEditRows(editRows.filter((_, idx) => idx !== i));

  // 保存编辑某一轮公示
  const saveEdit = async (hi: number) => {
    const valid = editRows
      .filter((r) => r.prize.trim())
      .map((r) => ({
        prize: r.prize.trim(),
        winners: r.winners
          .split(/[、,，]+/)
          .map((s) => s.trim())
          .filter(Boolean),
      }));
    if (valid.length === 0) return show("请至少填写一个奖项名称", true);
    setBusy(true);
    const r = await apiPost({ updateHistory: hi, results: valid });
    show(r.ok ? "已保存该轮公示" : String(r.data.msg || "保存失败"), !r.ok);
    if (r.ok) {
      cancelEdit();
      await refresh();
    }
    setBusy(false);
  };

  // 删除某轮历史公示
  const removeHistory = async (hi: number) => {
    if (!confirm(`确定删除这一轮历史公示吗？\n${new Date(history[hi].time).toLocaleString()}`)) return;
    setBusy(true);
    const r = await apiPost({ deleteHistory: hi });
    show(r.ok ? "已删除该轮公示" : String(r.data.msg || "操作失败"), !r.ok);
    if (r.ok) {
      if (editingIdx === hi) cancelEdit();
      await refresh();
    }
    setBusy(false);
  };

  const totalWinners = results.reduce((s, r) => s + (r.winners || []).length, 0);

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <div className={styles.title}>抽奖管理</div>
        <div className={clsx(styles.badge, active ? styles.badgeOn : styles.badgeOff)}>
          {active ? "● 参与开放中" : "○ 参与已关闭"}
        </div>
      </div>

      {/* 参与开关 */}
      <div className={styles.configBox}>
        <div className={styles.configLabel}>参与控制</div>
        <div className={styles.configRow}>
          <button
            className={clsx("button", active ? "button--danger" : "button--primary", styles.uploadButton)}
            disabled={busy}
            onClick={toggleActive}>
            {active ? "关闭参与" : "开放参与"}
          </button>
          <button
            className={clsx("button button--secondary", styles.uploadButton)}
            disabled={busy}
            onClick={clearParticipants}>
            清空参与者
          </button>
          <button
            className={clsx("button button--danger", styles.uploadButton)}
            disabled={busy}
            onClick={resetRound}>
            重置整轮
          </button>
        </div>
        <div className={styles.configHint}>
          当前参与者 {participants.length} 人
        </div>
      </div>

      {/* 奖项配置 */}
      <div className={styles.configBox}>
        <div className={styles.configLabel}>奖项配置</div>
        {config.map((p, i) => (
          <div className={styles.configRow} key={i}>
            <input
              className={styles.input}
              placeholder="奖项名称，如 一等奖"
              value={p.name}
              onChange={(e) => updatePrize(i, { name: e.target.value })}
            />
            <input
              className={clsx(styles.input, styles.inputNum)}
              type="number"
              min="1"
              placeholder="人数"
              value={p.count}
              onChange={(e) => updatePrize(i, { count: Number(e.target.value) })}
            />
            <button
              className={clsx("button button--sm button--danger", styles.smallBtn)}
              onClick={() => removePrize(i)}>
              删除
            </button>
          </div>
        ))}
        <div className={styles.configRow}>
          <button
            className={clsx("button button--sm button--secondary")}
            onClick={addPrize}>
            ＋ 添加奖项
          </button>
          <button
            className={clsx("button button--sm button--primary")}
            disabled={busy}
            onClick={saveConfig}>
            保存奖项
          </button>
          <button
            className={clsx("button button--sm button--success")}
            disabled={busy}
            onClick={execDraw}>
            🎲 执行抽奖
          </button>
        </div>
        <div className={styles.configHint}>
          共配置 {config.reduce((s, p) => s + (Number(p.count) || 0), 0)} 个中奖名额
        </div>
      </div>

      {msg && (
        <div className={msgError ? styles.addMsgError : styles.addMsg}>{msg}</div>
      )}

      <div className={styles.twoCol}>
        {/* 参与者 */}
        <div className={styles.listBox}>
          <div className={styles.configLabel}>参与者（{participants.length}）</div>
          {participants.length === 0 ? (
            <div className={styles.empty}>暂无参与者</div>
          ) : (
            <div className={styles.participantGrid}>
              {participants.map((name, i) => (
                <span className={styles.participant} key={i}>
                  {name}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* 中奖名单 */}
        <div className={styles.listBox}>
          <div className={styles.configLabel}>中奖名单（{totalWinners} 人）</div>
          {results.length === 0 ? (
            <div className={styles.empty}>尚未抽奖</div>
          ) : (
            results.map((r, i) => (
              <div className={styles.resultRow} key={i}>
                <span className={styles.resultPrize}>{r.prize}</span>
                <span className={styles.resultWinners}>
                  {(r.winners || []).join("、") || "—"}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 中奖公示历史 */}
      <div className={styles.listBox}>
        <div className={styles.configRow}>
          <div className={styles.configLabel}>
            中奖公示历史（{history.length} 轮）
          </div>
          <button
            className={clsx("button button--sm button--danger", styles.uploadButton)}
            disabled={busy || history.length === 0}
            onClick={clearHistory}>
            清空公示
          </button>
        </div>
        {history.length === 0 ? (
          <div className={styles.empty}>暂无历史公示</div>
        ) : (
          history.map((h, hi) => (
            <div className={styles.historyRound} key={hi}>
              <div className={styles.historyRoundHead}>
                <span className={styles.historyRoundTime}>
                  {new Date(h.time).toLocaleString()}
                </span>
                <div className={styles.historyRoundOps}>
                  {editingIdx !== hi ? (
                    <>
                      <button
                        className={clsx("button button--sm button--secondary", styles.smallBtn)}
                        disabled={busy}
                        onClick={() => startEdit(hi)}>
                        编辑
                      </button>
                      <button
                        className={clsx("button button--sm button--danger", styles.smallBtn)}
                        disabled={busy}
                        onClick={() => removeHistory(hi)}>
                        删除
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className={clsx("button button--sm button--primary", styles.smallBtn)}
                        disabled={busy}
                        onClick={() => saveEdit(hi)}>
                        保存
                      </button>
                      <button
                        className={clsx("button button--sm", styles.smallBtn)}
                        disabled={busy}
                        onClick={cancelEdit}>
                        取消
                      </button>
                    </>
                  )}
                </div>
              </div>

              {editingIdx === hi ? (
                <div className={styles.editBox}>
                  {editRows.map((row, ri) => (
                    <div className={styles.configRow} key={ri}>
                      <input
                        className={styles.input}
                        placeholder="奖项名称"
                        value={row.prize}
                        onChange={(e) => updateEditRow(ri, { prize: e.target.value })}
                      />
                      <input
                        className={clsx(styles.input, styles.inputWinners)}
                        placeholder="中奖人，用、分隔"
                        value={row.winners}
                        onChange={(e) => updateEditRow(ri, { winners: e.target.value })}
                      />
                      <button
                        className={clsx("button button--sm button--danger", styles.smallBtn)}
                        onClick={() => removeEditRow(ri)}>
                        删除
                      </button>
                    </div>
                  ))}
                  <button
                    className={clsx("button button--sm button--secondary", styles.smallBtn, styles.addRowBtn)}
                    onClick={addEditRow}>
                    ＋ 添加奖项行
                  </button>
                </div>
              ) : (
                (h.results || []).map((r, ri) => (
                  <div className={styles.resultRow} key={ri}>
                    <span className={styles.resultPrize}>{r.prize}</span>
                    <span className={styles.resultWinners}>
                      {(r.winners || []).join("、") || "—"}
                    </span>
                  </div>
                ))
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
