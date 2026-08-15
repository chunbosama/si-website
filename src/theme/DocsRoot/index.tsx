import clsx from "clsx";
import React, { useEffect } from "react";
import { useCookies } from "react-cookie";

import renderRoutes from "@docusaurus/renderRoutes";
import { useHistory } from "@docusaurus/router";
import {
  HtmlClassNameProvider,
  ThemeClassNames,
} from "@docusaurus/theme-common";
import Layout from "@theme/Layout";

import styles from "./styles.module.css";

import type { Props } from "@theme/DocVersionRoot";
function accessDeny() {
  const history = useHistory();

  return (
    <div className={clsx(styles.accessDeny, "alert alert--danger")}>
      ❌ 您没有权限查看该目录 请
      <a
        className={styles.a}
        onClick={() => {
          history.push("/backend/login?jumpto=/docs/intro");
        }}>
        登录
      </a>
    </div>
  );
}

export default function DocsRoot(props: Props): JSX.Element {
  const [cookies, , removeCookie] = useCookies();
  const isLogon = cookies.email;

  const history = useHistory();

  // 伪登录防护：本地有 email cookie 但服务端会话已失效时，
  // 清除本地登录标记并回到登录界面。
  useEffect(() => {
    if (!isLogon) return;
    let cancelled = false;
    fetch("/api/SessionHandler")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d && !d.loggedIn) {
          removeCookie("email", { path: "/" });
          history.replace("/backend/login?jumpto=/docs/intro");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLogon]);

  return (
    <HtmlClassNameProvider className={clsx(ThemeClassNames.wrapper.docsPages)}>
      <Layout>
        {isLogon ? renderRoutes(props.route.routes) : accessDeny()}
      </Layout>
    </HtmlClassNameProvider>
  );
}
