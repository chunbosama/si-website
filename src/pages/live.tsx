import Layout from "@theme/Layout";
import { useEffect, useRef, useState } from "react";

export default function Live() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<"loading" | "playing" | "error" | "empty">("loading");
  const [message, setMessage] = useState("");
  const playerRef = useRef<any>(null);

  // 读取后台配置的 FLV 直播链接
  useEffect(() => {
    fetch("/api/LiveConfigHandler?t=" + Date.now())
      .then((r) => (r.ok ? r.json() : { url: "" }))
      .then((data) => {
        setUrl((data.url || "").trim());
      })
      .catch(() => setUrl(""));
  }, []);

  // 用 flv.js 播放 FLV 视频流（动态引入，仅在浏览器端加载，避免 SSR 报错）
  useEffect(() => {
    let cancelled = false;
    let player: any = null;

    if (!videoRef.current) return;
    if (!url) {
      setStatus((s) => (s === "loading" ? "empty" : s));
      return;
    }

    const video = videoRef.current;

    async function start() {
      // flv.js 会在 import 时访问浏览器全局对象，必须动态加载
      const flvjs = await import("flv.js").then((m) => m.default || m);
      if (cancelled) return;

      if (flvjs.isSupported()) {
        player = flvjs.createPlayer(
          {
            type: "flv",
            isLive: true,
            url: url,
          },
          { enableStashBuffer: false, autoCleanupSourceBuffer: true }
        );
        player.attachMediaElement(video);
        player.load();
        player.on(flvjs.Events.ERROR, () => {
          setStatus("error");
          setMessage("视频流加载失败（请检查直播链接是否正确）");
        });
        player.on(flvjs.Events.STATISTICS_INFO, () => {
          setStatus("playing");
          setMessage("");
        });
        player.play().catch(() => setStatus("error"));
      } else {
        // 不支持 MediaSource 时，退化为原生视频播放（部分服务器支持直接 http-flv 播放）
        video.src = url;
        video.play().catch(() => {
          setStatus("error");
          setMessage("当前浏览器不支持 FLV 直播，请更换浏览器");
        });
      }
    }

    start();

    return () => {
      cancelled = true;
      if (player) {
        player.pause();
        player.unload();
        player.detachMediaElement();
        player.destroy();
        player = null;
      }
      video.removeAttribute("src");
      video.load();
    };
  }, [url]);

  return (
    <Layout title="直播">
      <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
        <h1 style={{ textAlign: "center", marginBottom: 16 }}>直播</h1>

        {status === "empty" ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              minHeight: "40vh",
            }}>
            <p style={{ color: "var(--ifm-color-emphasis-600)" }}>
              暂未设置直播，请联系管理员在后台配置直播链接
            </p>
          </div>
        ) : (
          <>
            <div
              style={{
                width: "100%",
                backgroundColor: "#000",
                borderRadius: 12,
                overflow: "hidden",
                boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
                aspectRatio: "16 / 9",
              }}>
              <video
                ref={videoRef}
                controls
                autoPlay
                playsInline
                style={{ width: "100%", height: "100%", display: "block" }}
              />
            </div>
            <div style={{ textAlign: "center", marginTop: 12, minHeight: 24 }}>
              {status === "loading" && (
                <p style={{ color: "var(--ifm-color-emphasis-600)" }}>正在加载直播…</p>
              )}
              {status === "playing" && url && (
                <p style={{ color: "var(--ifm-color-success)" }}>直播进行中</p>
              )}
              {status === "error" && (
                <p style={{ color: "var(--ifm-color-danger)" }}>{message}</p>
              )}
            </div>
          </>
        )}
      </div>
    </Layout>
  );
}
