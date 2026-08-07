import Layout from "@theme/Layout";

import DrawForm from "../components/DrawForm";
import styles from "./styles/draw.module.css";

export default function Draw() {
  return (
    <Layout title="抽奖">
      <div className={styles.background}>
        <DrawForm />
      </div>
    </Layout>
  );
}
