import Layout from "@theme/Layout";
import { useEffect, useState } from "react";

import SignUpForm from "../components/SignUpForm";
import styles from "./styles/sign_up.module.css";

async function getSignupTime() {
  try {
    const resp = await fetch("/api/SignUpConfigHandler?t=" + Date.now());
    if (resp.ok) {
      return await resp.json();
    }
  } catch (e) {}
  return { start: "", end: "" };
}

export default function Signup() {
  const [signupTime, setSignupTime] = useState<{
    start: string;
    end: string;
  }>({ start: "", end: "" });

  useEffect(() => {
    getSignupTime().then(setSignupTime);
  }, []);

  // 根据配置的报名时间判断是否开放
  // 若未配置时间，则不开放（保持安全）
  let masterSwitch = false;
  const now = new Date().getTime();
  if (signupTime.start && signupTime.end) {
    const start = new Date(signupTime.start).getTime();
    const end = new Date(signupTime.end).getTime();
    if (now >= start && now <= end) {
      masterSwitch = true;
    }
  }

  const isClosed = !masterSwitch;

  return (
    <Layout title="报名">
      <div className={styles.background}>
        {isClosed && (
          <b className="alert alert--danger shadow--md">❌ 报名已截止</b>
        )}
        <SignUpForm masterSwitch={masterSwitch} autoClear={true} />
      </div>
    </Layout>
  );
}
