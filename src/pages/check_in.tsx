import Layout from "@theme/Layout";

import CheckInForm from "../components/CheckInForm";
import styles from "./styles/check_in.module.css";

export default function CheckIn() {
  return (
    <Layout title="签到">
      <div className={styles.background}>
        <CheckInForm />
      </div>
    </Layout>
  );
}
