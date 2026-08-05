import Layout from "@theme/Layout";
import { useEffect } from "react";

export default function Live() {
  useEffect(() => {
    fetch("/api/LiveConfigHandler?t=" + Date.now())
      .then((r) => (r.ok ? r.json() : { url: "" }))
      .then((data) => {
        const url = (data.url || "").trim();
        if (url) {
          window.location.href = url;
        }
      })
      .catch(() => {});
  }, []);

  return (
    <Layout title="直播">
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "50vh",
        }}>
        <p style={{ color: "var(--ifm-color-emphasis-600)" }}>
          正在跳转到直播…（请联系管理员设置直播链接）
        </p>
      </div>
    </Layout>
  );
}
