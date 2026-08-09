import React, { useEffect, useState } from "react";
import { useCookies } from "react-cookie";

import Navbar from "../Navbar";
import Sidebar from "../Sidebar";
import styles from "./index.module.css";

// 关键：导出共享的权限上下文，供各管理组件判断是否为只读（普通用户）
export const RoleContext = React.createContext<{
  role: string | null;
  isAdmin: boolean;
  isSuper: boolean;
  isReadonly: boolean;
}>({ role: null, isAdmin: false, isSuper: false, isReadonly: false });

export function useRole() {
  return React.useContext(RoleContext);
}

function Layout(props: {
  children?: React.ReactNode[];
  showIfLogon?: boolean;
}) {
  const { children: childrens, showIfLogon } = props;

  const [cookie] = useCookies();
  const isLogon = cookie.email;

  const [role, setRole] = useState<string | null>(null);
  const [isSidebarShow, setIsSidebarShow] = useState(false);
  const [contentIndex, setContentIndex] = useState(0);

  // 拉取当前用户角色（super 超级管理员 / admin 管理员 / user 普通用户）
  useEffect(() => {
    if (!isLogon) return;
    let cancelled = false;
    fetch("/api/SessionHandler")
      .then((r) => r.json())
      .then((d) => {
        if (!cancelled && d && d.role) setRole(d.role);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [isLogon]);

  const isReadonly = role === "user"; // 普通用户只能看不能改

  return (
    <RoleContext.Provider
      value={{ role, isAdmin: role === "admin" || role === "super", isSuper: role === "super", isReadonly }}>
      <div className={styles.background}>
        <Navbar sidebar={isSidebarShow} setSidebar={setIsSidebarShow} />

        {isLogon && (
          <Sidebar
            sidebar={isSidebarShow}
            setSidebar={setIsSidebarShow}
            setContentIndex={setContentIndex}
            role={role}
          />
        )}
        <main className={styles.main} data-readonly={isReadonly}>
          {showIfLogon
            ? isLogon && childrens[contentIndex]
            : childrens[contentIndex]}
        </main>
        {isReadonly && (
          <div className={styles.readonlyOverlay}>当前账号为普通用户，仅可查看</div>
        )}
      </div>
    </RoleContext.Provider>
  );
}

export default Layout;
