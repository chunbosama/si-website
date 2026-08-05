import clsx from "clsx";
import { useEffect, useState } from "react";

import styles from "./index.module.css";

async function getLiveUrl() {
  try {
    const resp = await fetch("/api/LiveConfigHandler?t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return { url: "" };
}

async function saveLiveUrl(url: string) {
  const resp = await fetch("/api/LiveConfigHandler", {
    method: "POST",
    body: JSON.stringify({ url: url }),
  });
  return resp.ok;
}

export default function LiveManager() {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState(0);

  const statusText = {
    0: "保存链接",
    1: "保存中…",
    2: "已保存",
  };

  useEffect(() => {
    getLiveUrl().then((r) => setUrl(r.url || ""));
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <div className={styles.title}>直播管理</div>
      </div>

      <div className={styles.configBox}>
        <div className={styles.configLabel}>直播链接</div>
        <div className={styles.configRow}>
          <input
            className={styles.input}
            type="text"
            placeholder="https://example.com/live"
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setStatus(0);
            }}
          />
        </div>
        <div className={styles.configHint}>
          保存后，主页导航栏的「直播」标签将跳转到此链接
        </div>
        <button
          className={clsx("button button--primary", styles.uploadButton)}
          disabled={status === 1}
          onClick={async () => {
            setStatus(1);
            const ok = await saveLiveUrl(url);
            if (ok) {
              setStatus(2);
              setTimeout(() => setStatus(0), 1500);
            } else {
              setStatus(0);
              alert("保存失败");
            }
          }}>
          {statusText[status]}
        </button>
      </div>
    </div>
  );
}
