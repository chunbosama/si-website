import clsx from "clsx";
import { useEffect, useState } from "react";

import styles from "./index.module.css";

async function getMemberCount() {
  try {
    const resp = await fetch("/api/MemberConfigHandler?t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return { newbie: 0, management: 0 };
}

async function saveMemberCount(newbie: number, management: number) {
  const resp = await fetch("/api/MemberConfigHandler", {
    method: "POST",
    body: JSON.stringify({ newbie: newbie, management: management }),
  });
  return resp.ok;
}

export default function MemberManager() {
  const [newbie, setNewbie] = useState(0);
  const [management, setManagement] = useState(0);
  const [status, setStatus] = useState(0);

  const statusText = {
    0: "保存人数",
    1: "保存中…",
  };

  useEffect(() => {
    getMemberCount().then((c) => {
      setNewbie(Number(c.newbie) || 0);
      setManagement(Number(c.management) || 0);
    });
  }, []);

  const total = (Number(newbie) || 0) + (Number(management) || 0);

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <div className={styles.title}>人员管理</div>
      </div>

      <div className={styles.configBox}>
        <div className={styles.configLabel}>社团人数</div>
        <div className={styles.configRow}>
          <span>新社员：</span>
          <input
            className={styles.input}
            type="number"
            min="0"
            value={newbie}
            onChange={(e) => {
              setNewbie(e.target.value);
            }}
          />
        </div>
        <div className={styles.configRow}>
          <span>管理层：</span>
          <input
            className={styles.input}
            type="number"
            min="0"
            value={management}
            onChange={(e) => {
              setManagement(e.target.value);
            }}
          />
        </div>
        <div className={styles.configHint}>总计：{total} 人</div>
        <button
          className={clsx("button button--primary", styles.uploadButton)}
          disabled={status === 1}
          onClick={async () => {
            setStatus(1);
            const ok = await saveMemberCount(
              Number(newbie) || 0,
              Number(management) || 0
            );
            if (ok) {
              alert("保存成功");
            } else {
              alert("保存失败");
            }
            setStatus(0);
          }}>
          {statusText[status]}
        </button>
      </div>
    </div>
  );
}
