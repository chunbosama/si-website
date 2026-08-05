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

function MemberCounter() {
  const [count, setCount] = useState<{ newbie: number; management: number }>({
    newbie: 0,
    management: 0,
  });

  useEffect(() => {
    getMemberCount().then(setCount);
  }, []);

  const newbie = Number.isFinite(count.newbie) ? count.newbie : 0;
  const management = Number.isFinite(count.management)
    ? count.management
    : 0;
  const total = newbie + management;

  return (
    <div className={clsx("card shadow--md", styles.card)}>
      <p>
        <span className={styles.caption}>社团人数</span>
        <span className={styles.subCaption}>(不完全统计)</span>
      </p>
      <table className={styles.table}>
        <thead className={styles.tableHead}>
          <tr className={styles.tableRow}>
            <th scope="col">新社员</th>
            <th scope="col">管理层</th>
            <th scope="col">总计</th>
          </tr>
        </thead>
        <tbody className={styles.tableBody}>
          <tr className={styles.tableRow}>
            <td>{newbie}</td>
            <td>{management}</td>
            <td>{total}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default MemberCounter;
