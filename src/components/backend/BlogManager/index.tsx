import clsx from "clsx";
import { useEffect, useState } from "react";

import styles from "./index.module.css";

interface BlogMeta {
  file: string;
  title: string;
  slug: string;
}

async function listBlogs(): Promise<BlogMeta[]> {
  try {
    const resp = await fetch("/api/BlogHandler?get=list&t=" + Date.now());
    if (resp.ok) return await resp.json();
  } catch (e) {}
  return [];
}

async function getBlog(file: string): Promise<string> {
  const resp = await fetch(
    "/api/BlogHandler?get=one&file=" + encodeURIComponent(file) + "&t=" + Date.now()
  );
  if (resp.ok) return await resp.text();
  return "";
}

async function saveBlog(data: any) {
  const resp = await fetch("/api/BlogHandler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  return resp.ok ? await resp.json() : null;
}

async function deleteBlog(file: string) {
  const resp = await fetch("/api/BlogHandler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ delete: file }),
  });
  return resp.ok;
}

async function rebuild() {
  const resp = await fetch("/api/BlogHandler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rebuild: true }),
  });
  return resp.ok;
}

// 简单解析 frontmatter 的作者名
function parseAuthor(raw: string): string {
  const m = raw.match(/^\s*-\s*name:\s*(.+)$/m);
  return m ? m[1].trim() : "";
}
// 解析头像链接（image_url）
function parseAvatar(raw: string): string {
  const m = raw.match(/^\s*image_url:\s*(.+)$/m);
  return m ? m[1].trim() : "";
}
function parseContent(raw: string): string {
  // 去掉 frontmatter（--- 到 ---），返回正文
  const idx = raw.indexOf("---", raw.indexOf("---") + 3);
  if (idx >= 0) return raw.slice(idx + 3).trim();
  return raw;
}

export default function BlogManager() {
  const [blogs, setBlogs] = useState<BlogMeta[]>([]);
  const [showEditor, setShowEditor] = useState(false);
  const [editFile, setEditFile] = useState("");
  const [form, setForm] = useState({
    title: "",
    slug: "",
    subtitle: "",
    author: "",
    avatar: "",
    content: "",
  });
  const [saveStatus, setSaveStatus] = useState(0);
  const [rebuildStatus, setRebuildStatus] = useState(0);

  const saveStatusText = { 0: "保存", 1: "保存中…", 2: "已保存" };
  const rebuildStatusText = { 0: "重新构建", 1: "构建中…", 2: "完成" };

  const refresh = async () => {
    setBlogs(await listBlogs());
  };

  useEffect(() => {
    refresh();
  }, []);

  const openNew = () => {
    setEditFile("");
    setForm({ title: "", slug: "", subtitle: "", author: "", avatar: "", content: "" });
    setShowEditor(true);
  };

  const openEdit = async (file: string) => {
    const raw = await getBlog(file);
    setEditFile(file);
    // 从原始 frontmatter 补 title/slug/subtitle/avatar
    const t = raw.match(/^title:\s*(.+)$/m);
    const s = raw.match(/^slug:\s*(.+)$/m);
    const d = raw.match(/^description:\s*(.+)$/m);
    setForm({
      title: t ? t[1].trim() : "",
      slug: s ? s[1].trim() : "",
      subtitle: d ? d[1].trim() : "",
      author: parseAuthor(raw),
      avatar: parseAvatar(raw),
      content: parseContent(raw),
    });
    setShowEditor(true);
  };

  const save = async () => {
    if (!form.title.trim() || !form.content.trim()) {
      alert("标题和内容不能为空");
      return;
    }
    setSaveStatus(1);
    const data: any = {
      title: form.title,
      slug: form.slug || form.title,
      subtitle: form.subtitle,
      author: form.author,
      avatar: form.avatar,
      content: form.content,
    };
    if (editFile) data.file = editFile;
    const r = await saveBlog(data);
    if (r && r.msg === "Success") {
      setSaveStatus(2);
      setTimeout(() => {
        setSaveStatus(0);
        setShowEditor(false);
        refresh();
      }, 800);
    } else {
      setSaveStatus(0);
      alert("保存失败");
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <div className={styles.title}>博客管理</div>
        <div className={styles.toolbar}>
          <button
            className={clsx("button button--secondary", styles.rebuildBtn)}
            disabled={rebuildStatus === 1}
            onClick={async () => {
              setRebuildStatus(1);
              const ok = await rebuild();
              setRebuildStatus(ok ? 2 : 0);
              if (ok) {
                setTimeout(() => setRebuildStatus(0), 1500);
              } else {
                alert("构建失败，请查看服务器日志");
              }
            }}>
            {rebuildStatusText[rebuildStatus]}
          </button>
          <button
            className={clsx("button button--primary", styles.newBtn)}
            onClick={openNew}>
            新建博客
          </button>
        </div>
      </div>

      {/* 编辑器 */}
      {showEditor && (
        <div className={styles.editor}>
          <div className={styles.editorTitle}>
            {editFile ? "编辑博客： " + editFile : "新建博客"}
          </div>
          <input
            className={styles.input}
            type="text"
            placeholder="标题 *"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
          <input
            className={styles.input}
            type="text"
            placeholder="slug（URL标识，如 my-post，默认用标题）"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value })}
          />
          <input
            className={styles.input}
            type="text"
            placeholder="副标题（可选，显示在标题下方的摘要）"
            value={form.subtitle}
            onChange={(e) => setForm({ ...form, subtitle: e.target.value })}
          />
          <input
            className={styles.input}
            type="text"
            placeholder="作者（可选）"
            value={form.author}
            onChange={(e) => setForm({ ...form, author: e.target.value })}
          />
          <input
            className={styles.input}
            type="text"
            placeholder="作者头像链接（可选，如 https://github.com/xxx.png）"
            value={form.avatar}
            onChange={(e) => setForm({ ...form, avatar: e.target.value })}
          />
          <textarea
            className={styles.textarea}
            rows={8}
            placeholder="博客内容（支持 Markdown）*"
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
          <div className={styles.editorBtns}>
            <button
              className={clsx("button button--primary", styles.saveBtn)}
              disabled={saveStatus === 1}
              onClick={save}>
              {saveStatusText[saveStatus]}
            </button>
            <button
              className="button button--secondary"
              onClick={() => setShowEditor(false)}>
              取消
            </button>
          </div>
        </div>
      )}

      {/* 博客列表 */}
      <table className={styles.table}>
        <thead className={styles.tableHead}>
          <tr className={styles.tableRow}>
            <th scope="col">标题</th>
            <th scope="col">slug</th>
            <th scope="col">文件名</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody className={styles.tableBody}>
          {blogs.map((b) => {
            return (
              <tr className={styles.tableRow} key={b.file}>
                <th scope="row">{b.title}</th>
                <td>{b.slug}</td>
                <td>{b.file}</td>
                <td>
                  <div className={styles.opRow}>
                    <div
                      className={styles.operate}
                      onClick={() => openEdit(b.file)}>
                      编辑
                    </div>
                    <div
                      className={styles.operate}
                      onClick={async () => {
                        if (!confirm(`确定删除博客「${b.title}」吗？`)) return;
                        const ok = await deleteBlog(b.file);
                        if (ok) {
                          refresh();
                        } else {
                          alert("删除失败");
                        }
                      }}>
                      删除
                    </div>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {blogs.length === 0 && <div className={styles.empty}>暂无博客</div>}
    </div>
  );
}
