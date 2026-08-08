import { useEffect, useState } from "react";

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

export default function StyleWall() {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [lightbox, setLightbox] = useState<Photo | null>(null);
  const [sort, setSort] = useState<"desc" | "asc">("desc"); // desc=最新在前 asc=最早在前

  useEffect(() => {
    getGallery().then((list) => {
      setPhotos(list);
      setLoaded(true);
    });
  }, []);

  const sorted = [...photos].sort((a, b) =>
    sort === "desc" ? b.addedAt - a.addedAt : a.addedAt - b.addedAt
  );

  return (
    <div className={styles.wall}>
      <div className={styles.titleWrap}>
        <div className={styles.title}>📸 社团风采</div>
        {photos.length > 0 && (
          <div className={styles.sortBar}>
            <span className={styles.sortLabel}>排序：</span>
            <button
              className={sort === "desc" ? styles.sortBtnActive : styles.sortBtn}
              onClick={() => setSort("desc")}>
              从新到旧
            </button>
            <button
              className={sort === "asc" ? styles.sortBtnActive : styles.sortBtn}
              onClick={() => setSort("asc")}>
              从旧到新
            </button>
          </div>
        )}
      </div>
      {photos.length === 0 && loaded && (
        <div className={styles.empty}>暂无照片，敬请期待！</div>
      )}
      <div className={styles.grid}>
        {sorted.map((p) => (
          <figure
            className={styles.photo}
            key={p.id}
            onClick={() => setLightbox(p)}>
            <img src={p.url} alt={p.caption || "社团风采"} loading="lazy" />
            {p.caption && <figcaption>{p.caption}</figcaption>}
          </figure>
        ))}
      </div>

      {lightbox && (
        <div className={styles.overlay} onClick={() => setLightbox(null)}>
          <div className={styles.lightbox} onClick={(e) => e.stopPropagation()}>
            <img src={lightbox.url} alt={lightbox.caption || ""} />
            {lightbox.caption && <div className={styles.lightboxCaption}>{lightbox.caption}</div>}
            <button
              className={styles.closeBtn}
              onClick={() => setLightbox(null)}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
