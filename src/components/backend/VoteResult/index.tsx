import clsx from "clsx";
import { useEffect, useState } from "react";

import styles from "./index.module.css";

interface VoteData {
  title: string;
  desc: string;
  items: VoteItems;
  max: number;
}

interface VoteDatas {
  [id: number]: VoteData;
}

interface VoteItems {
  [index: number]: string;
}

interface VoteResults {
  [id: number]: VoteResult;
}

interface VoteResult {
  [item: number]: number;
}

async function getData() {
  let mData: VoteDatas;
  await fetch("/api/VoteHandler?type=get&timestamp=" + Date.now().toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      if (response.ok) {
        return response.json();
      } else {
        console.error("Network response was not ok");
      }
    })
    .then((data: VoteDatas) => {
      mData = data;
    })
    .catch((error) => {
      console.error(error);
    });
  let mResult: VoteResults;
  await fetch("/api/VoteHandler?type=calc&timestamp=" + Date.now().toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
  })
    .then((response) => {
      if (response.ok) {
        return response.json();
      } else {
        console.error("Network response was not ok");
      }
    })
    .then((data: VoteResults) => {
      mResult = data;
    })
    .catch((error) => {
      console.error(error);
    });
  return { mData, mResult };
}

// 保存投票配置（datas）
async function saveDatas(datas: VoteDatas, clearRecords: boolean) {
  const resp = await fetch("/api/VoteHandler", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ _saveDatas: datas, _clearRecords: clearRecords }),
  });
  return resp.ok;
}

export default function VoteResult() {
  const [datas, setDatas] = useState(null as VoteDatas);
  const [results, setResults] = useState(null as VoteResults);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // 管理面板
  const [showManage, setShowManage] = useState(false);
  const [deleteMode, setDeleteMode] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newItems, setNewItems] = useState("");
  const [newMax, setNewMax] = useState(1);

  async function getAndSetData() {
    if (isRefreshing) return;
    setIsRefreshing(true);

    const { mData, mResult } = await getData();
    setDatas(mData);
    setResults(mResult);

    setTimeout(() => setIsRefreshing(false), 2000);
  }

  useEffect(() => {
    getAndSetData();
  }, []);

  // 添加投票
  const addVote = async () => {
    if (!newTitle.trim() || !newItems.trim()) {
      alert("请填写标题和选项");
      return;
    }
    const itemsArr = newItems
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (itemsArr.length === 0) {
      alert("选项不能为空");
      return;
    }
    const items: VoteItems = {};
    itemsArr.forEach((s, i) => {
      items[i] = s;
    });
    const next: VoteDatas = datas ? { ...datas } : {};
    let maxId = Object.keys(next).reduce((m, k) => Math.max(m, parseInt(k)), -1);
    const newId = String(maxId + 1);
    next[newId] = {
      title: newTitle,
      desc: newDesc,
      items: items,
      max: parseInt(String(newMax)) || 1,
    };
    const ok = await saveDatas(next, false);
    if (ok) {
      setDatas(next);
      setNewTitle("");
      setNewDesc("");
      setNewItems("");
      setNewMax(1);
      alert("添加成功");
    } else {
      alert("保存失败");
    }
  };

  // 删除投票
  const removeVote = async (id: string) => {
    if (!datas) return;
    const next = { ...datas };
    delete next[id];
    const ok = await saveDatas(next, false);
    if (ok) {
      setDatas(next);
    } else {
      alert("删除失败");
    }
  };

  // 清空票数
  const clearRecords = async () => {
    if (!confirm("确定清空所有投票的票数吗？")) return;
    const ok = await saveDatas(datas || {}, true);
    if (ok) {
      await getAndSetData();
      alert("已清空票数");
    } else {
      alert("操作失败");
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <button
          className={clsx(
            styles.toolButton,
            isRefreshing ? styles.unrefreshable : null
          )}
          onClick={getAndSetData}
          disabled={isRefreshing}
        >
          <svg
            height="24px"
            viewBox="0 -960 960 960"
            width="24px"
            fill="#5f6368"
          >
            <path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z" />
          </svg>
        </button>
        <button
          className={clsx(styles.toolButton, styles.deleteTool)}
          onClick={() => setDeleteMode(!deleteMode)}
        >
          <svg
            height="24px"
            viewBox="0 -960 960 960"
            width="24px"
            fill="#5f6368"
          >
            <path d="M280-120q-33 0-56.5-23.5T200-200v-520h-40v-80h200v-40h240v40h200v80h-40v520q0 33-23.5 56.5T680-120H280Zm400-600H280v520h400v-520ZM360-280h80v-360h-80v360Zm160 0h80v-360h-80v360ZM280-720v520-520Z" />
          </svg>
        </button>
        <button
          className={clsx(styles.toolButton, styles.addButton)}
          onClick={() => setShowManage(!showManage)}
        >
          <svg
            height="24px"
            viewBox="0 -960 960 960"
            width="24px"
            fill="#5f6368"
          >
            <path d="M440-440H200v-80h240v-240h80v240h240v80H520v240h-80v-240Z" />
          </svg>
        </button>
      </div>

      {/* 投票管理面板 */}
      {showManage && (
        <div className={styles.manage}>
          <div className={styles.manageTitle}>投票管理</div>
          <div className={styles.manageLabel}>新建投票</div>
          <input
            className={styles.manageInput}
            type="text"
            placeholder="标题"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <input
            className={styles.manageInput}
            type="text"
            placeholder="描述（可选）"
            value={newDesc}
            onChange={(e) => setNewDesc(e.target.value)}
          />
          <input
            className={styles.manageInput}
            type="text"
            placeholder="选项，用逗号分隔，如：A,B,C"
            value={newItems}
            onChange={(e) => setNewItems(e.target.value)}
          />
          <div className={styles.manageRow}>
            <label className={styles.manageSmallLabel}>最多可选：</label>
            <input
              className={styles.manageSmall}
              type="number"
              min="1"
              value={newMax}
              onChange={(e) => setNewMax(e.target.value)}
            />
            <button
              className={clsx("button button--primary", styles.manageBtn)}
              onClick={addVote}
            >
              添加投票
            </button>
          </div>

          <div className={styles.manageLabel}>已有投票</div>
          {datas &&
            Object.keys(datas).map((id) => (
              <div className={styles.voteRow} key={id}>
                <span className={styles.voteRowTitle}>
                  [{id}] {datas[id].title}
                </span>
                <span
                  className={styles.voteRowDel}
                  onClick={() => removeVote(id)}
                >
                  删除
                </span>
              </div>
            ))}
          {datas && Object.keys(datas).length === 0 && (
            <div className={styles.manageEmpty}>暂无投票</div>
          )}

          <button
            className={clsx("button button--danger", styles.manageBtn)}
            onClick={clearRecords}
          >
            清空所有票数
          </button>
        </div>
      )}

      {datas ? (
        Object.keys(datas).map((id) => {
          return (
            <div className={clsx(styles.group, "card shadow--md")} key={id}>
              <div className={styles.titleRow}>
                <div className={styles.title}>{datas[id].title}</div>
                {deleteMode && (
                  <button
                    className={clsx(
                      "button button--danger button--sm",
                      styles.deleteCard
                    )}
                    onClick={() => removeVote(id)}
                  >
                    删除
                  </button>
                )}
              </div>
              <div className={styles.desc}>{datas[id].desc}</div>
              {Object.keys(datas[id].items).map((index) => {
                const resultItem: VoteResult = results[id] || {};
                let total = 0;
                Object.keys(resultItem).forEach((i) => {
                  total += resultItem[i];
                });
                const count =
                  resultItem[index] !== undefined ? results[id][index] : 0;
                const percent = count / total || 0;
                return (
                  <div className={styles.item} key={index}>
                    <div
                      className={styles.fill}
                      style={{
                        width: `${total ? percent * 100 : 0}%`,
                      }}
                    />
                    <div
                      className={clsx(
                        styles.text,
                        percent <= 0.1 ? styles.textOverflow : null
                      )}
                    >
                      {datas[id].items[index] + ": " + count}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })
      ) : (
        <div className={styles.loading}>加载中…</div>
      )}
    </div>
  );
}
