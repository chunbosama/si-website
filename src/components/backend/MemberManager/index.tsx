import clsx from "clsx";
import { useEffect, useState } from "react";

import styles from "./index.module.css";

interface Member {
  name: string;
  position: string;
  addedAt: number;
}

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

async function getMembers() {
  try {
    const resp = await fetch("/api/MemberListHandler?t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return [];
}

async function addMembers(names: string[], position: string) {
  const resp = await fetch("/api/MemberListHandler", {
    method: "POST",
    body: JSON.stringify({ names: names, position: position }),
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, data: JSON.parse(text) };
  } catch (e) {
    return { ok: resp.ok, data: { msg: text } };
  }
}

async function deleteMembers(names: string[]) {
  const resp = await fetch("/api/MemberListHandler", {
    method: "DELETE",
    body: JSON.stringify({ names: names }),
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, data: JSON.parse(text) };
  } catch (e) {
    return { ok: resp.ok, data: { msg: text } };
  }
}

export default function MemberManager() {
  const [newbie, setNewbie] = useState(0);
  const [management, setManagement] = useState(0);
  const [status, setStatus] = useState(0);

  const statusText = {
    0: "保存人数",
    1: "保存中…",
  };

  // 人员名单
  const [members, setMembers] = useState<Member[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [positionInput, setPositionInput] = useState("");
  const [batchText, setBatchText] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [addMsg, setAddMsg] = useState("");
  const [addStatus, setAddStatus] = useState(0); // 0 默认 1 处理中
  const [finding, setFinding] = useState("");

  useEffect(() => {
    getMemberCount().then((c) => {
      setNewbie(Number(c.newbie) || 0);
      setManagement(Number(c.management) || 0);
    });
    getMembers().then((list) => {
      setMembers(list);
      setLoaded(true);
    });
  }, []);

  const total = (Number(newbie) || 0) + (Number(management) || 0);
  const canAdd = nameInput.trim().length > 0 || batchText.trim().length > 0;

  const refresh = async () => {
    setMembers(await getMembers());
    setSelected(new Set());
    setAddMsg("");
  };

  // 通过名称定位选中（用于删除）
  const targetNames = (): string[] => {
    const names: string[] = [];
    members.forEach((m, i) => {
      if (selected.has(i)) names.push(m.name);
    });
    return names;
  };

  const handleAdd = async () => {
    const names: string[] = [];
    if (nameInput.trim()) names.push(nameInput.trim());
    if (batchText.trim()) {
      names.push(
        ...batchText
          .split(/[\n,，]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      );
      // 确保传入的是数组（后端支持数组），去重交给后端
    }
    if (names.length === 0) return;
    setAddStatus(1);
    setAddMsg("");
    const r = await addMembers(names, positionInput);
    if (r.ok) {
      const d = r.data || {};
      setAddMsg(`已添加 ${d.added} 人，跳过重复 ${d.skipped} 人，当前共 ${d.total} 人`);
      setNameInput("");
      setBatchText("");
      await refresh();
    } else {
      setAddMsg(String((r.data && r.data.msg) || "添加失败"));
    }
    setAddStatus(0);
  };

  const handleDelete = async () => {
    const names = targetNames();
    if (names.length === 0) return;
    if (!confirm(`确定删除选中的 ${names.length} 人吗？\n` + names.join("、"))) return;
    setAddStatus(1);
    const r = await deleteMembers(names);
    if (r.ok) {
      const d = r.data || {};
      setAddMsg(`已删除 ${d.removed} 人，当前共 ${d.total} 人`);
    } else {
      setAddMsg(String((r.data && r.data.msg) || "删除失败"));
    }
    await refresh();
    setAddStatus(0);
  };

  const handleDeleteOne = async (name: string, idx: number) => {
    if (!confirm(`确定删除「${name}」吗？`)) return;
    setAddStatus(1);
    const r = await deleteMembers([name]);
    if (r.ok) {
      const d = r.data || {};
      setAddMsg(`已删除「${name}」，当前共 ${d.total} 人`);
    } else {
      setAddMsg(String((r.data && r.data.msg) || "删除失败"));
    }
    await refresh();
    setAddStatus(0);
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
      return prev.size === members.length
        ? new Set()
        : new Set(members.map((_, i) => i));
    });
  };

  const filtered = finding.trim()
    ? members.filter((m) => m.name.toLowerCase().includes(finding.trim().toLowerCase()))
    : members;
  // filtered 是 members 的子集，但索引可能不同；统一按 members 原索引定位
  const filteredIdx = finding.trim()
    ? members
        .map((m, i) => ({ m, i }))
        .filter(({ m }) => m.name.toLowerCase().includes(finding.trim().toLowerCase()))
        .map(({ i }) => i)
    : members.map((_, i) => i);

  const fmtTime = (t: number) => {
    if (!t) return "";
    return new Date(t).toLocaleString();
  };

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
              setNewbie(Number(e.target.value));
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
              setManagement(Number(e.target.value));
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

      {/* 人员名单表格 */}
      <div className={styles.listBox}>
        <div className={styles.configLabel}>人员名单（{members.length} 人）</div>
        <div className={styles.configHint}>
          只有在此名单内的名字，签到才会显示「签到成功」。
        </div>

        {/* 搜索 */}
        <div className={styles.configRow}>
          <input
            className={styles.input}
            type="text"
            placeholder="搜索名字…"
            value={finding}
            onChange={(e) => setFinding(e.target.value)}
          />
        </div>

        {/* 批量删除工具栏 */}
        {selected.size > 0 && (
          <div className={styles.batchBar}>
            已选 {selected.size} 人
            <button
              className={clsx("button button--sm button--danger", styles.smallBtn)}
              disabled={addStatus === 1}
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
                  checked={members.length > 0 && selected.size === members.length}
                  onChange={toggleSelectAll}
                />
              </th>
              <th scope="col">#</th>
              <th scope="col">名字</th>
              <th scope="col">职位</th>
              <th scope="col">加入时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody className={styles.tableBody}>
            {!loaded && (
              <tr className={styles.tableRow}>
                <td colSpan={6}>加载中…</td>
              </tr>
            )}
            {loaded && filteredIdx.length === 0 && (
              <tr className={styles.tableRow}>
                <td colSpan={6}>名单为空</td>
              </tr>
            )}
            {filteredIdx.map((idx, pos) => {
              const m = members[idx];
              return (
                <tr
                  className={clsx(styles.tableRow, selected.has(idx) && styles.rowSelected)}
                  key={idx}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(idx)}
                      onChange={() => toggleSelect(idx)}
                    />
                  </td>
                  <th scope="row">{pos + 1}</th>
                  <td>{m.name}</td>
                  <td>{m.position || "-"}</td>
                  <td>{fmtTime(m.addedAt) || "-"}</td>
                  <td>
                    <button
                      className={clsx("button button--sm button--secondary", styles.smallBtn)}
                      disabled={addStatus === 1}
                      onClick={() => handleDeleteOne(m.name, idx)}>
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* 添加区域 */}
        <div className={styles.addBox}>
          <div className={styles.addLabel}>添加人员</div>
          <div className={styles.configRow}>
            <span>姓名：</span>
            <input
              className={styles.input}
              type="text"
              placeholder="单个姓名"
              value={nameInput}
              onChange={(e) => setNameInput(e.target.value)}
            />
            <span>职位：</span>
            <input
              className={styles.input}
              type="text"
              placeholder="如：社员/管理层"
              value={positionInput}
              onChange={(e) => setPositionInput(e.target.value)}
            />
          </div>
          <div className={styles.addLabel}>批量添加（每行一人，或用逗号分隔）：</div>
          <textarea
            className={styles.textarea}
            rows={4}
            placeholder={"张三\n李四\n王五"}
            value={batchText}
            onChange={(e) => setBatchText(e.target.value)}
          />
          <button
            className={clsx("button button--primary", styles.uploadButton)}
            disabled={!canAdd || addStatus === 1}
            onClick={handleAdd}>
            {addStatus === 1 ? "处理中…" : "添加"}
          </button>
          {addMsg && <div className={styles.addMsg}>{addMsg}</div>}
        </div>
      </div>
    </div>
  );
}
