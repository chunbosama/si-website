import Layout from "@theme/Layout";
import StyleWall from "../components/StyleWall";

import styles from "./styles/style.module.css";

export default function Style() {
  return (
    <Layout title="社团风采">
      <div className={styles.background}>
        <StyleWall />
      </div>
    </Layout>
  );
}
