import clsx from "clsx";
import { useEffect, useState } from "react";

import { useRole } from "../Layout";

import styles from "./index.module.css";

interface User {
  email: string;
  role: "user" | "admin" | "super";
  roleName: string;
  nick: string;
  active: boolean;
  createdAt: number;
}

async function getUsers() {
  try {
    const resp = await fetch("/api/UserAdminHandler?t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return { users: [], current: null };
}

async function saveUser(email: string, payload: Record<string, unknown>) {
  const resp = await fetch("/api/UserAdminHandler", {
    method: "POST",
    body: JSON.stringify({ email: email, ...payload }),
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, data: JSON.parse(text) };
  } catch (e) {
    return { ok: resp.ok, data: { msg: text } };
  }
}

async function deleteUser(email: string) {
  const resp = await fetch("/api/UserAdminHandler", {
    method: "DELETE",
    body: JSON.stringify({ email: email }),
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, data: JSON.parse(text) };
  } catch (e) {
    return { ok: resp.ok, data: { msg: text } };
  }
}

const fmtTime = (t: number) => {
  if (!t) return "-";
  return new Date(t).toLocaleString();
};

export default function UserManager() {
  const { role, isSuper, isAdmin } = useRole();
  const [users, setUsers] = useState<User[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [finding, setFinding] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // 编辑状态（仅超级管理员可编辑）
  const [editing, setEditing] = useState<string | null>(null);

  const refresh = async () => {
    const d = await getUsers();
    setUsers(d.users || []);
    setCurrent(d.current || null);
    setLoaded(true);
  };

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = finding.trim()
    ? users.filter((u) =>
        (u.email + " " + u.nick)
          .toLowerCase()
          .includes(finding.trim().toLowerCase())
      )
    : users;

  const roleBadge = (u: User) => {
    if (u.role === "super")
      return <span className={clsx(styles.badge, styles.badgeSuper)}>超级管理员</span>;
    if (u.role === "admin")
      return <span className={clsx(styles.badge, styles.badgeAdmin)}>管理员</span>;
    return <span className={clsx(styles.badge, styles.badgeUser)}>普通用户</span>;
  };

  const toggleEdit = (email: string) => {
    setEditing((prev) => (prev === email ? null : email));
    setMsg("");
    setErr("");
  };

  const handleSave = async (email: string, payload: Record<string, unknown>) => {
    setBusy(true);
    setMsg("");
    setErr("");
    const r = await saveUser(email, payload);
    setBusy(false);
    if (r.ok) {
      setMsg("保存成功");
      setEditing(null);
      await refresh();
    } else {
      setErr(String((r.data && r.data.msg) || "保存失败"));
    }
  };

  const handleDelete = async (u: User) => {
    if (!confirm(`确定删除用户「${u.email}」吗？此操作不可恢复。`)) return;
    setBusy(true);
    setErr("");
    const r = await deleteUser(u.email);
    setBusy(false);
    if (r.ok) {
      setMsg(`已删除用户 ${u.email}`);
      await refresh();
    } else {
      setErr(String((r.data && r.data.msg) || "删除失败"));
    }
  };

  const handleEditSave = (email: string) => {
    // 触发保存：从编辑表单读取（每个用户行的编辑表单通过 data 属性传递）
    const form = document.querySelector(
      `[data-edit-email="${CSS.escape(email)}"]`
    ) as HTMLElement | null;
    if (!form) return;
    const nick = (form.querySelector('[name="nick"]') as HTMLInputElement)?.value ?? "";
    const roleVal = (form.querySelector('[name="role"]') as HTMLSelectElement)?.value ?? "";
    const active = (form.querySelector('input[name="active"]') as HTMLInputElement)?.checked ?? true;
    const password = (form.querySelector('input[name="password"]') as HTMLInputElement)?.value ?? "";
    const newEmail = (form.querySelector('input[name="newEmail"]') as HTMLInputElement)?.value ?? "";
    const payload: Record<string, unknown> = {
      nick: nick,
      role: roleVal,
      active: active,
    };
    if (password) payload.password = password;
    if (newEmail.trim()) payload.newEmail = newEmail.trim();
    handleSave(email, payload);
  };

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <div className={styles.title}>用户管理</div>
      </div>

      {!isSuper && isAdmin && (
        <div className={clsx(styles.permissionHint, styles.listBox)}>
          当前为管理员，仅可查看用户列表；编辑与删除用户需超级管理员权限。
        </div>
      )}

      {msg && <div className={styles.addMsg}>{msg}</div>}
      {err && <div className={styles.errMsg}>{err}</div>}

      <div className={styles.listBox}>
        <div className={styles.configLabel}>用户列表（{users.length} 人）</div>
        <div className={styles.configHint}>
          普通用户仅可查看后台；管理员可管理业务数据；超级管理员可管理用户与所有业务。
        </div>

        <div>
          <input
            className={styles.input}
            type="text"
            placeholder="搜索邮箱或昵称…"
            value={finding}
            onChange={(e) => setFinding(e.target.value)}
          />
        </div>

        <table className={styles.table}>
          <thead className={styles.tableHead}>
            <tr className={styles.tableRow}>
              <th scope="col">邮箱</th>
              <th scope="col">昵称</th>
              <th scope="col">角色</th>
              <th scope="col">状态</th>
              <th scope="col">注册时间</th>
              <th scope="col">操作</th>
            </tr>
          </thead>
          <tbody className={styles.tableBody}>
            {!loaded && (
              <tr className={styles.tableRow}>
                <td colSpan={6}>加载中…</td>
              </tr>
            )}
            {loaded && filtered.length === 0 && (
              <tr className={styles.tableRow}>
                <td colSpan={6}>暂无用户</td>
              </tr>
            )}
            {filtered.map((u) => {
              const isEditing = editing === u.email;
              return (
                <tr
                  className={clsx(styles.tableRow, !u.active && styles.rowDisabled)}
                  key={u.email}>
                  <td>
                    {u.email}
                    {u.email === current && (
                      <span style={{ color: "#999", marginLeft: 6 }}>(当前)</span>
                    )}
                  </td>
                  <td>{u.nick || "-"}</td>
                  <td>{roleBadge(u)}</td>
                  <td>
                    {u.active ? (
                      <span className={styles.statusOn}>启用</span>
                    ) : (
                      <span className={styles.statusOff}>停用</span>
                    )}
                  </td>
                  <td>{fmtTime(u.createdAt)}</td>
                  <td>
                    {!isEditing && (
                      <>
                        <button
                          className={clsx("button button--sm button--secondary", styles.smallBtn)}
                          disabled={!isSuper || busy}
                          onClick={() => toggleEdit(u.email)}>
                          编辑
                        </button>
                        <button
                          className={clsx("button button--sm button--danger", styles.smallBtn)}
                          disabled={!isSuper || busy || u.email === current}
                          onClick={() => handleDelete(u)}>
                          删除
                        </button>
                      </>
                    )}
                    {isEditing && isSuper && (
                      <>
                        <button
                          className={clsx("button button--sm button--primary", styles.smallBtn)}
                          disabled={busy}
                          onClick={() => handleEditSave(u.email)}>
                          保存
                        </button>
                        <button
                          className={clsx("button button--sm button--secondary", styles.smallBtn)}
                          disabled={busy}
                          onClick={() => toggleEdit(u.email)}>
                          取消
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {editing && isSuper && (
          <div className={styles.editBox} data-edit-email={editing}>
            {filtered
              .filter((u) => u.email === editing)
              .map((u) => (
                <div key={u.email} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>昵称</span>
                    <input className={styles.input} name="nick" defaultValue={u.nick} />
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>角色</span>
                    <select className={styles.select} name="role" defaultValue={u.role}>
                      <option value="user">普通用户</option>
                      <option value="admin">管理员</option>
                      <option value="super">超级管理员</option>
                    </select>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>状态</span>
                    <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <input type="checkbox" name="active" defaultChecked={u.active} />
                      启用账号（取消勾选则禁止登录）
                    </label>
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>改邮箱</span>
                    <input className={styles.input} name="newEmail" placeholder="留空则不变" />
                  </div>
                  <div className={styles.row}>
                    <span className={styles.rowLabel}>重置密码</span>
                    <input
                      className={styles.input}
                      name="password"
                      type="text"
                      placeholder="留空则不修改"
                    />
                  </div>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
