import clsx from "clsx";
import { useEffect, useState } from "react";

import styles from "./index.module.css";

async function getActive() {
  try {
    const resp = await fetch("/api/SigninHandler?get=active&t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return { active: false, event: "", records: [] };
}

async function getEvents() {
  try {
    const resp = await fetch("/api/SigninHandler?get=events&t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return [];
}

async function getRecords(event: string) {
  try {
    const resp = await fetch(
      "/api/SigninHandler?get=records&event=" + event + "&t=" + Date.now()
    );
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return [];
}

export default function SigninManager() {
  const [active, setActive] = useState(false);
  const [curEvent, setCurEvent] = useState("");
  const [records, setRecords] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [subtitleStatus, setSubtitleStatus] = useState(0);
  const [publishStatus, setPublishStatus] = useState(0);

  const subtitleStatusText = {
    0: "保存副标题",
    1: "保存中…",
    2: "已保存",
  };

  const publishStatusText = {
    0: "发布签到",
    1: "处理中…",
  };
  // 按 event 加载记录
  const loadRecords = async (ev: string) => {
    if (!ev) {
      setRecords([]);
      return;
    }
    setRecords(await getRecords(ev));
  };

  // 刷新状态 + 事件列表
  const refresh = async () => {
    const r = await getActive();
    setActive(r.active);
    setSubtitle(r.subtitle || "");
    const ev = r.event || "";
    setCurEvent(ev);
    // 默认：有进行中看进行中，否则看最近一次
    if (ev) {
      setSelectedEvent(ev);
      await loadRecords(ev);
    } else {
      const evs = await getEvents();
      setEvents(evs);
      if (evs.length > 0) {
        const latest = evs[0].event;
        setSelectedEvent(latest);
        await loadRecords(latest);
      } else {
        setSelectedEvent("");
        setRecords([]);
      }
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const publish = async () => {
    setPublishStatus(1);
    await fetch("/api/SigninHandler", {
      method: "POST",
      body: JSON.stringify({ publish: true }),
    });
    await refresh();
    setPublishStatus(0);
  };

  const stop = async () => {
    setPublishStatus(1);
    await fetch("/api/SigninHandler", {
      method: "POST",
      body: JSON.stringify({ publish: false }),
    });
    await refresh();
    setPublishStatus(0);
  };

  // 切换查看某一轮历史
  const selectEvent = async (ev: string) => {
    setSelectedEvent(ev);
    await loadRecords(ev);
  };

  const fmtTime = (t: any) => {
    const n = Number(t);
    return new Date(n).toLocaleString();
  };

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <div className={styles.title}>签到管理</div>
      </div>

      <div className={styles.configBox}>
        <div className={styles.configLabel}>签到控制</div>
        <div className={styles.state}>
          当前状态：
          {active ? (
            <span className={styles.online}>● 签到进行中</span>
          ) : (
            <span className={styles.offline}>○ 已停止</span>
          )}
        </div>
        <div className={styles.btnRow}>
          {!active ? (
            <button
              className={clsx("button button--primary", styles.btn)}
              disabled={publishStatus === 1}
              onClick={publish}>
              {publishStatus === 1
                ? publishStatusText[1]
                : publishStatusText[0]}
            </button>
          ) : (
            <button
              className={clsx("button button--danger", styles.btn)}
              disabled={publishStatus === 1}
              onClick={stop}>
              停止签到
            </button>
          )}
        </div>
      </div>

      {/* 副标题编辑 */}
      <div className={styles.configBox}>
        <div className={styles.configLabel}>签到副标题</div>
        <div className={styles.configRow}>
          <input
            className={styles.input}
            type="text"
            placeholder="如：周六社团活动签到"
            value={subtitle}
            onChange={(e) => {
              setSubtitle(e.target.value);
              setSubtitleStatus(0);
            }}
          />
        </div>
        <button
          className={clsx("button button--primary", styles.uploadButton)}
          disabled={subtitleStatus === 1}
          onClick={async () => {
            setSubtitleStatus(1);
            const resp = await fetch("/api/SigninHandler", {
              method: "POST",
              body: JSON.stringify({ setSubtitle: subtitle }),
            });
            if (resp.ok) {
              setSubtitleStatus(2);
              setTimeout(() => setSubtitleStatus(0), 1500);
            } else {
              setSubtitleStatus(0);
              alert("保存失败");
            }
          }}>
          {subtitleStatusText[subtitleStatus]}
        </button>
      </div>

      {/* 签到历史切换 */}
      <div className={styles.historyBar}>
        <label htmlFor="eventSelect" className={styles.historyLabel}>
          查看签到历史：
        </label>
        <select
          id="eventSelect"
          className={styles.select}
          value={selectedEvent}
          onChange={(e) => selectEvent(e.target.value)}>
          {events.length === 0 && <option value="">暂无历史签到</option>}
          {events.map((ev) => (
            <option key={ev.event} value={ev.event}>
              {fmtTime(ev.time)}（{ev.count} 人）
              {ev.event === curEvent ? "  [进行中]" : ""}
            </option>
          ))}
        </select>
      </div>

      <table className={styles.table}>
        <thead className={styles.tableHead}>
          <tr className={styles.tableRow}>
            <th scope="col">序号</th>
            <th scope="col">名字</th>
            <th scope="col">签到时间</th>
          </tr>
        </thead>
        <tbody className={styles.tableBody}>
          {records.map((r, i) => {
            return (
              <tr className={styles.tableRow} key={i}>
                <th scope="row">{i + 1}</th>
                <td>{r.name}</td>
                <td>{new Date(r.time).toLocaleString()}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className={styles.count}>已签到：{records.length} 人</div>
      {records.length === 0 && (
        <div className={styles.empty}>
          {active ? "暂无签到记录" : "签到已停止，可点「发布签到」开启新一轮"}
        </div>
      )}
    </div>
  );
}
