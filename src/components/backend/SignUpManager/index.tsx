import clsx from "clsx";
import { useEffect, useState } from "react";

import styles from "./index.module.css";

// 获取报名配置（时间 + 跳转链接）
async function getSignupConfig() {
  try {
    const resp = await fetch("/api/SignUpConfigHandler?t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return { start: "", end: "", submitRedirectUrl: "" };
}

// 保存报名时间配置
async function saveSignupTime(start: string, end: string) {
  const resp = await fetch("/api/SignUpConfigHandler", {
    method: "POST",
    body: JSON.stringify({ start: start, end: end }),
  });
  return resp.ok;
}

// 保存提交后跳转链接
async function saveRedirectUrl(url: string) {
  const resp = await fetch("/api/SignUpConfigHandler", {
    method: "POST",
    body: JSON.stringify({ submitRedirectUrl: url }),
  });
  return resp.ok;
}

// 获取报名列表
async function getPartList() {
  try {
    const resp = await fetch("/api/SignUpHandler?t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return {};
}

export default function SignUpManager() {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("");
  const [partList, setPartList] = useState<{ [key: string]: any }>({});
  const [timeStatus, setTimeStatus] = useState(0);
  const [redirectStatus, setRedirectStatus] = useState(0);

  const timeStatusText = {
    0: "保存报名时间",
    1: "保存中…",
    2: "已保存",
  };

  const redirectStatusText = {
    0: "保存链接",
    1: "保存中…",
    2: "已保存",
  };

  useEffect(() => {
    getSignupConfig().then((t) => {
      setStart(t.start || "");
      setEnd(t.end || "");
      setRedirectUrl(t.submitRedirectUrl || "");
    });
    getPartList().then(setPartList);
  }, []);

  return (
    <div className={styles.container}>
      {/* 报名时间编辑 */}
      <div className={styles.titleBar}>
        <div className={styles.title}>报名管理</div>
      </div>

      <div className={styles.configBox}>
        <div className={styles.configLabel}>报名开放时间</div>
        <div className={styles.configRow}>
          <span>开始：</span>
          <input
            className={styles.input}
            type="datetime-local"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
            }}
          />
        </div>
        <div className={styles.configRow}>
          <span>结束：</span>
          <input
            className={styles.input}
            type="datetime-local"
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
            }}
          />
        </div>
        <button
          className={clsx("button button--primary", styles.uploadButton)}
          disabled={timeStatus === 1}
          onClick={async () => {
            setTimeStatus(1);
            const ok = await saveSignupTime(start, end);
            setTimeStatus(ok ? 2 : 0);
            setTimeout(() => setTimeStatus(0), 1500);
          }}>
          {timeStatusText[timeStatus]}
        </button>
        {/* 时间状态预览 */}
        <div className={styles.configHint}>
          {start && end
            ? `开放中：${new Date(start).toLocaleString()} 至 ${new Date(
                end
              ).toLocaleString()}`
            : "未设置报名时间（报名默认关闭）"}
        </div>
      </div>

      {/* 提交后跳转链接编辑 */}
      <div className={styles.configBox}>
        <div className={styles.configLabel}>提交后跳转链接</div>
        <div className={styles.configRow}>
          <input
            className={styles.input}
            type="text"
            placeholder="https://example.com/thanks"
            value={redirectUrl}
            onChange={(e) => {
              setRedirectUrl(e.target.value);
              setRedirectStatus(0);
            }}
          />
        </div>
        <div className={styles.configHint}>
          填写后，用户提交报名成功会自动跳转到此链接；留空则不跳转
        </div>
        <button
          className={clsx("button button--primary", styles.uploadButton)}
          disabled={redirectStatus === 1}
          onClick={async () => {
            setRedirectStatus(1);
            const ok = await saveRedirectUrl(redirectUrl);
            setRedirectStatus(ok ? 2 : 0);
            if (!ok) alert("保存失败");
            setTimeout(() => setRedirectStatus(0), 1500);
          }}>
          {redirectStatusText[redirectStatus]}
        </button>
      </div>

      {/* 报名信息列表 */}
      <table className={styles.table}>
        <thead className={styles.tableHead}>
          <tr className={styles.tableRow}>
            <th scope="col">姓名</th>
            <th scope="col">班级</th>
            <th scope="col">邮箱</th>
            <th scope="col">手机号</th>
            <th scope="col">报名时间</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody className={styles.tableBody}>
          {Object.keys(partList).map((key) => {
            const item = partList[key];
            return (
              <tr className={styles.tableRow} key={key}>
                <th scope="row">{item.name}</th>
                <td>{item.classes}</td>
                <td>{item.email}</td>
                <td>{item.phone}</td>
                <td>{new Date(Number.parseInt(key)).toLocaleString()}</td>
                <td>
                  <div
                    className={styles.operate}
                    onClick={async () => {
                      const ok = await fetch("/api/SignUpHandler", {
                        method: "DELETE",
                        body: JSON.stringify({ timestamp: key }),
                      }).then((r) => r.ok);
                      if (ok) {
                        const next = { ...partList };
                        delete next[key];
                        setPartList(next);
                      } else {
                        alert("删除失败");
                      }
                    }}>
                    删除
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {Object.keys(partList).length === 0 && (
        <div className={styles.empty}>暂无报名记录</div>
      )}
    </div>
  );
}
