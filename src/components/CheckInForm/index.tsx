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

export default function CheckInForm() {
  const [name, setName] = useState("");
  const [active, setActive] = useState(false);
  const [event, setEvent] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [status, setStatus] = useState(0); // 0=默认 1=提交中 2=成功 3=失败
  const [msg, setMsg] = useState("");

  const statusText = {
    0: "签到",
    1: "签到中…",
    2: "签到成功",
    3: "重试",
  };

  useEffect(() => {
    getActive().then((r) => {
      setActive(r.active);
      setEvent(r.event || "");
      setSubtitle(r.subtitle || "");
    });
  }, []);

  const doCheckIn = async () => {
    setStatus(1);
    setMsg("");
    const resp = await fetch("/api/SigninHandler", {
      method: "POST",
      body: JSON.stringify({ name: name, event: event }),
    });
    const text = await resp.text();
    if (resp.ok && text === "Success") {
      setStatus(2);
      setMsg("已记录，感谢参与！");
    } else {
      setStatus(3);
      setMsg(text.replace("Error: ", "") || "签到失败");
    }
  };

  return (
    <div className={clsx("card shadow--md", styles.card)}>
      <div className={styles.title}>今日签到</div>
      {subtitle && <div className={styles.subtitle}>{subtitle}</div>}

      {active ? (
        <>
          <div className={styles.composedInput}>
            <label htmlFor="name">名字:</label>
            <input
              className={styles.input}
              type="text"
              id="name"
              placeholder="请输入你的名字"
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
            disabled={
              name.length === 0 || status === 1 || status === 2
            }
            onClick={doCheckIn}>
            {statusText[status]}
          </button>
        </>
      ) : (
        <div className={styles.closed}>
          <b>⏸ 当前没有进行中的签到</b>
        </div>
      )}

      {msg && <div className={styles.msg}>{msg}</div>}
    </div>
  );
}
