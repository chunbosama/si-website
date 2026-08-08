import clsx from "clsx";
import { useEffect, useRef, useState } from "react";

import styles from "./index.module.css";

interface Photo {
  id: string;
  url: string;
  caption: string;
  addedAt: number;
}

async function getGallery(): Promise<Photo[]> {
  try {
    const resp = await fetch("/api/GalleryHandler?t=" + Date.now());
    if (resp.ok) {
      const data = await resp.json();
      return Array.isArray(data) ? data : [];
    }
  } catch (e) {}
  return [];
}

async function apiPost(body: any) {
  const resp = await fetch("/api/GalleryHandler", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await resp.text();
  try {
    return { ok: resp.ok, data: JSON.parse(text) };
  } catch (e) {
    return { ok: resp.ok, data: { msg: text } };
  }
}

export default function GalleryManager() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [msgError, setMsgError] = useState(false);
  const [caption, setCaption] = useState("");
  const [preview, setPreview] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCaption, setEditCaption] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const show = (t: string, err = false) => {
    setMsg(t);
    setMsgError(err);
  };

  const refresh = async () => {
    setPhotos(await getGallery());
  };

  useEffect(() => {
    refresh();
  }, []);

  const onFileSelected = (file: File | undefined) => {
    if (!file) return;
    if (!/^image\//.test(file.type)) {
      show("请选择图片文件", true);
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      show("图片过大（最大 15MB）", true);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPreview(String(reader.result));
    };
    reader.readAsDataURL(file);
  };

  // 上传
  const upload = async () => {
    if (!preview) {
      show("请先选择图片", true);
      return;
    }
    // dataURL: data:image/png;base64,xxx
    const m = preview.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
    if (!m) {
      show("图片格式不支持", true);
      return;
    }
    setBusy(true);
    const r = await apiPost({
      action: "upload",
      data: m[2],
      ext: m[1] === "jpeg" ? "jpg" : m[1],
      caption,
    });
    if (r.ok) {
      show("上传成功");
      setCaption("");
      setPreview("");
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } else {
      show(String(r.data.msg || "上传失败"), true);
    }
    setBusy(false);
  };

  // 删除
  const remove = async (id: string) => {
    if (!confirm("确定删除这张照片吗？此操作不可恢复。")) return;
    setBusy(true);
    const r = await apiPost({ action: "delete", id });
    show(r.ok ? "已删除" : String(r.data.msg || "删除失败"), !r.ok);
    if (r.ok) await refresh();
    setBusy(false);
  };

  // 编辑说明
  const saveCaption = async (id: string) => {
    setBusy(true);
    const r = await apiPost({ action: "update", id, caption: editCaption });
    show(r.ok ? "已保存说明" : String(r.data.msg || "保存失败"), !r.ok);
    if (r.ok) {
      setEditingId(null);
      await refresh();
    }
    setBusy(false);
  };

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <div className={styles.title}>风采管理</div>
      </div>

      {/* 上传 */}
      <div className={styles.configBox}>
        <div className={styles.configLabel}>上传照片</div>
        <div className={styles.configRow}>
          <input
            ref={fileRef}
            className={styles.fileInput}
            type="file"
            accept="image/*"
            onChange={(e) => onFileSelected(e.target.files?.[0])}
          />
        </div>
        {preview && (
          <div className={styles.preview}>
            <img src={preview} alt="预览" />
          </div>
        )}
        <div className={styles.configRow}>
          <span className={styles.smallLabel}>说明：</span>
          <input
            className={styles.input}
            type="text"
            placeholder="给照片加一句说明（可选）"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            maxLength={100}
          />
        </div>
        <button
          className={clsx("button button--primary", styles.uploadButton)}
          disabled={busy || !preview}
          onClick={upload}>
          {busy ? "上传中…" : "上传照片"}
        </button>
      </div>

      {msg && (
        <div className={msgError ? styles.addMsgError : styles.addMsg}>{msg}</div>
      )}

      {/* 照片列表 */}
      <div className={styles.listBox}>
        <div className={styles.configLabel}>已上传照片（{photos.length}）</div>
        {photos.length === 0 ? (
          <div className={styles.empty}>暂无照片</div>
        ) : (
          <div className={styles.grid}>
            {photos.map((p) => (
              <div className={styles.photoCard} key={p.id}>
                <img src={p.url} alt={p.caption || "照片"} />
                <div className={styles.photoOps}>
                  {editingId === p.id ? (
                    <>
                      <input
                        className={styles.input}
                        type="text"
                        value={editCaption}
                        maxLength={100}
                        autoFocus
                        onChange={(e) => setEditCaption(e.target.value)}
                      />
                      <button
                        className={clsx("button button--sm button--primary", styles.smallBtn)}
                        disabled={busy}
                        onClick={() => saveCaption(p.id)}>
                        保存
                      </button>
                      <button
                        className={clsx("button button--sm", styles.smallBtn)}
                        disabled={busy}
                        onClick={() => setEditingId(null)}>
                        取消
                      </button>
                    </>
                  ) : (
                    <>
                      <span className={styles.caption}>
                        {p.caption || "（无说明）"}
                      </span>
                      <div className={styles.ops}>
                        <button
                          className={clsx("button button--sm button--secondary", styles.smallBtn)}
                          disabled={busy}
                          onClick={() => {
                            setEditingId(p.id);
                            setEditCaption(p.caption);
                          }}>
                          编辑
                        </button>
                        <button
                          className={clsx("button button--sm button--danger", styles.smallBtn)}
                          disabled={busy}
                          onClick={() => remove(p.id)}>
                          删除
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
