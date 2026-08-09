import clsx from "clsx";
import { useEffect, useState } from "react";
import { useCookies } from "react-cookie";

import { useHistory } from "@docusaurus/router";

import styles from "./index.module.css";

export default function Sidebar(props: {
  sidebar: boolean;
  setSidebar: (sidebar: boolean) => void;
  setContentIndex: (index: number) => void;
  role?: string | null;
}) {
  const { sidebar, setSidebar, setContentIndex, role } = props;

  const [index, setIndex] = useState(0);
  const [cookie, setCookie, removeCookie] = useCookies();

  const history = useHistory();

  const isAdminish = role === "admin" || role === "super";

  useEffect(() => {
    // 普通用户看不到用户管理，若当前所在页超出范围则回到总览
    if (!isAdminish && index > 11) setIndex(0);
    setContentIndex(index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  return (
    <div className={styles.parent}>
      <div
        role="presentation"
        className={styles.presentation}
        data-show={sidebar}
        onClick={() => {
          setSidebar(false);
        }}
      />
      <aside className={styles.sidebar} data-show={sidebar}>
        <nav
          aria-label="侧边栏"
          className={clsx(styles.background, "thin-scrollbar")}>
          <div className={styles.items}>
            <div
              className={clsx(styles.item, index === 0 && styles.item__active)}
              onClick={() => {
                setIndex(0);
              }}>
              <svg
                height="24px"
                viewBox="0 0 24 24"
                width="24px"
                fill="#5f6368">
                <rect fill="none" height="24" width="24" />
                <path d="M19,3H5C3.9,3,3,3.9,3,5v14c0,1.1,0.9,2,2,2h14c1.1,0,2-0.9,2-2V5C21,3.9,20.1,3,19,3z M5,19V5h6v14H5z M19,19h-6v-7h6V19z M19,10h-6V5h6V10z" />
              </svg>
              总览
            </div>
            <div
              className={clsx(styles.item, index === 1 && styles.item__active)}
              onClick={() => {
                setIndex(1);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M240-80q-50 0-85-35t-35-85v-80q0-17 11.5-28.5T160-320h80v-536q0-7 6-9.5t11 2.5l29 29q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l32-32q6-6 14-6t14 6l32 32q6 6 14 6t14-6l29-29q5-5 11-2.5t6 9.5v656q0 50-35 85t-85 35H240Zm480-80q17 0 28.5-11.5T760-200v-560H320v440h320q17 0 28.5 11.5T680-280v80q0 17 11.5 28.5T720-160ZM400-680h160q17 0 28.5 11.5T600-640q0 17-11.5 28.5T560-600H400q-17 0-28.5-11.5T360-640q0-17 11.5-28.5T400-680Zm0 120h160q17 0 28.5 11.5T600-520q0 17-11.5 28.5T560-480H400q-17 0-28.5-11.5T360-520q0-17 11.5-28.5T400-560Zm280-40q-17 0-28.5-11.5T640-640q0-17 11.5-28.5T680-680q17 0 28.5 11.5T720-640q0 17-11.5 28.5T680-600Zm0 120q-17 0-28.5-11.5T640-520q0-17 11.5-28.5T680-560q17 0 28.5 11.5T720-520q0 17-11.5 28.5T680-480ZM240-160h360v-80H200v40q0 17 11.5 28.5T240-160Zm-40 0v-80 80Z" />
              </svg>
              经费
            </div>
            <div
              className={clsx(styles.item, index === 2 && styles.item__active)}
              onClick={() => {
                setIndex(2);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M470-200h-10q-142 0-241-99t-99-241q0-142 99-241t241-99q71 0 132.5 26.5t108 73q46.5 46.5 73 108T800-540q0 134-75.5 249T534-111q-10 5-20 5.5t-18-4.5q-8-5-14-13t-7-19l-5-58Zm90-26q71-60 115.5-140.5T720-540q0-109-75.5-184.5T460-800q-109 0-184.5 75.5T200-540q0 109 75.5 184.5T460-280h100v54Zm-101-95q17 0 29-12t12-29q0-17-12-29t-29-12q-17 0-29 12t-12 29q0 17 12 29t29 12Zm-87-304q11 5 22 .5t18-14.5q9-12 21-18.5t27-6.5q24 0 39 13.5t15 34.5q0 13-7.5 26T480-558q-25 22-37 41.5T431-477q0 12 8.5 20.5T460-448q12 0 20-9t12-21q5-17 18-31t24-25q21-21 31.5-42t10.5-42q0-46-31.5-74T460-720q-32 0-59 15.5T357-662q-6 11-1.5 21.5T372-625Zm88 112Z" />
              </svg>
              Q&A
            </div>
            <div
              className={clsx(styles.item, index === 3 && styles.item__active)}
              onClick={() => {
                setIndex(3);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M200-80q-33 0-56.5-23.5T120-160v-182l110-125 57 57-80 90h546l-78-88 57-57 108 123v182q0 33-23.5 56.5T760-80H200Zm0-80h560v-80H200v80Zm225-225L284-526q-23-23-22.5-56.5T285-639l196-196q23-23 57-24t57 22l141 141q23 23 24 56t-22 56L538-384q-23 23-56.5 22.5T425-385Zm255-254L539-780 341-582l141 141 198-198ZM200-160v-80 80Z" />
              </svg>
              投票
            </div>
            <div
              className={clsx(styles.item, index === 4 && styles.item__active)}
              onClick={() => {
                setIndex(4);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880Zm0 80q-50 0-94.5 14T303-768l-42-68q35-23 75-38.5T414-894l66 94Zm0 0 66-94q35 10 76 25t74 39l-42 68q-38-22-81-36t-93-14Zm-20 320 146-146q11-11 28-11t28 11q11 11 11 28t-11 28L508-424q-12 12-28 12t-28-12L340-536q-11-11-11-28t11-28q11-11 28-11t28 11l64 64Zm99 400 66-93q35 10 76 25t74 39l-42 68q-38 22-81 36t-93 14ZM480-640Zm0 0Zm20 480v0Zm0 0ZM366-846l-42 68q-33-16-66-29t-71-22l41-67q35 10 69 23.5t69 26.5Zm228 0q35-13 69-26.5t69-23.5l41 67q-38 9-71 22t-66 29l-42-68ZM175-786l42 68q-16 33-28.5 69.5T177-648l-68-42q10-35 23.5-68.5T175-786Zm610 0q33 14 46.5 47.5T855-690l-68 42q-2-38-15-74.5T745-786l40 0ZM120-578l68 42q-2 38 15 74.5t32 65.5l-40 0q-36 0-61.5-25.5T98-578h22Zm720 0h22q0 36-25.5 61.5T777-496l-40 0q15-28 32-64.5t15-75.5l56 58ZM240-280v-170q0-17 11.5-28.5T280-490h100q17 0 28.5 11.5T420-450v90h120v-90q0-17 11.5-28.5T580-490h100q17 0 28.5 11.5T720-450v170q0 17-11.5 28.5T680-240H280q-17 0-28.5-11.5T240-280Zm40 200q-33 0-56.5-23.5T200-160v-80q0-17 5-31.5t16-27.5l80-80h158v40H280q-17 0-28.5 11.5T240-320v80h100v40h80v40H280Z" />
              </svg>
              报名
            </div>
            <div
              className={clsx(styles.item, index === 5 && styles.item__active)}
              onClick={() => {
                setIndex(5);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm240-320q33 0 56.5-23.5T560-640q0-33-23.5-56.5T480-720q-33 0-56.5 23.5T400-640q0 33 23.5 56.5T480-560Zm0-80Zm0 400Z" />
              </svg>
              人员
            </div>
            <div
              className={clsx(styles.item, index === 6 && styles.item__active)}
              onClick={() => {
                setIndex(6);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M160-200q-33 0-56.5-23.5T80-280v-400q0-33 23.5-56.5T160-760h640q33 0 56.5 23.5T880-680v400q0 33-23.5 56.5T800-200H160Zm0-80h280v-400H160v400Zm360 0h280v-140H520v140Zm0-220h280v-180H520v180Z" />
              </svg>
              签到
            </div>
            <div
              className={clsx(styles.item, index === 7 && styles.item__active)}
              onClick={() => {
                setIndex(7);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M160-200q-33 0-56.5-23.5T80-280v-400q0-33 23.5-56.5T160-760h400q33 0 56.5 23.5T640-680v160l160-160v480L640-440v160q0 33-23.5 56.5T560-200H160Zm400-560H160v480h400v-480Zm-280 360v-40h240v40H280Zm0-120v-40h240v40H280Z" />
              </svg>
              直播
            </div>
            <div
              className={clsx(styles.item, index === 8 && styles.item__active)}
              onClick={() => {
                setIndex(8);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520h200L520-800v200Z" />
              </svg>
              博客
            </div>
            <div
              className={clsx(styles.item, index === 9 && styles.item__active)}
              onClick={() => {
                setIndex(9);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M280-240q-17 0-28.5-11.5T240-280q0-17 11.5-28.5T280-320h400q17 0 28.5 11.5T720-280q0 17-11.5 28.5T680-240H280Zm0-200q-17 0-28.5-11.5T240-480q0-17 11.5-28.5T280-520h400q17 0 28.5 11.5T720-480q0 17-11.5 28.5T680-480H280Zm0-200q-17 0-28.5-11.5T240-680q0-17 11.5-28.5T280-720h400q17 0 28.5 11.5T720-680q0 17-11.5 28.5T680-680H280ZM200-80q-33 0-56.5-23.5T120-160v-560l67-67q12-12 28.5-12t28.5 13l58 58 58-58q12-12 29-12t29 12l58 58 58-58q12-12 29-12t29 12l58 58 58-58q12-12 29-12t29 12l58 58 58-58q12-12 29-12t29 12l58 58 58-58q12-12 29-12t29 12l58 58 58-58q12-12 29-12t29 12l58 58 58-58q12-12 29-12t29 12l58 58 58-58q12-12 28.5-12t28.5 13v560q0 33-23.5 56.5T840-80H200Z" />
              </svg>
              注册码
            </div>
            <div
              className={clsx(styles.item, index === 10 && styles.item__active)}
              onClick={() => {
                setIndex(10);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M480-880q114 0 227 57-20 43-34 89-39-23-84-36t-109-13q-132 0-226 94t-94 226q0 132 94 226t226 94q17 0 34-2t34-5l-18 79q-8 4-16 6t-17 2q-150 0-256-106T120-463q0-150 106-256t256-106q150 0 256 106t106 256q0 88-44 195t-117 120q-10-69-58-116t-118-55q23-18 36-43t13-53q0-25-9-47t-26-38q-17-17-39-26t-47-9q-50 0-85 35t-35 85q0 29 13 54t36 43q5 14 7 28t2 29q0 28-21 47t-49 19q-25 0-47-9t-39-26q-17-17-26-39t-9-47q0-74 53-126.5T480-467q74 0 126.5 52.5T659-288q42 0 71.5-29.5T760-388q0-7-1-14t-3-13q34-40 56-92t22-108q0-114-57-171.5t-57.5-58.5Q690-880 480-880Zm0 160q27 0 46 19t19 46q0 27-19 46t-46 19q-27 0-46-19t-19-46q0-27 19-46t46-19Zm140 160q27 0 46 19t19 46q0 27-19 46t-46 19q-27 0-46-19t-19-46q0-27 19-46t46-19Zm-280 0q27 0 46 19t19 46q0 27-19 46t-46 19q-27 0-46-19t-19-46q0-27 19-46t46-19Z" />
              </svg>
              抽奖
            </div>
            <div
              className={clsx(styles.item, index === 11 && styles.item__active)}
              onClick={() => {
                setIndex(11);
              }}>
              <svg
                height="24px"
                viewBox="0 -960 960 960"
                width="24px"
                fill="#5f6368">
                <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h560q33 0 56.5 23.5T880-760v560q0 33-23.5 56.5T800-120H200Zm0-80h560v-560H200v560Zm80-80h400L545-470 440-340l-65-85-95 125Zm0-160h400L545-470 440-340l-65-85-95 125Z" />
              </svg>
              风采
            </div>
            {isAdminish && (
              <div
                className={clsx(styles.item, index === 12 && styles.item__active)}
                onClick={() => {
                  setIndex(12);
                }}>
                <svg
                  height="24px"
                  viewBox="0 -960 960 960"
                  width="24px"
                  fill="#5f6368">
                  <path d="M480-480q-66 0-113-47t-47-113q0-66 47-113t113-47q66 0 113 47t47 113q0 66-47 113t-113 47ZM160-160v-112q0-34 17.5-62.5T224-378q62-31 126-46.5T480-440q66 0 130 15.5T736-378q29 15 46.5 43.5T800-272v112H160Zm80-80h480v-32q0-11-5.5-20T700-306q-54-27-109-40.5T480-360q-56 0-111 13.5T260-306q-9 5-14.5 14t-5.5 20v32Zm240-320q33 0 56.5-23.5T560-640q0-33-23.5-56.5T480-720q-33 0-56.5 23.5T400-640q0 33 23.5 56.5T480-560Zm0-80Zm0 400Z" />
                </svg>
                <span>用户管理</span>
              </div>
            )}
          </div>
          <div
            className={styles.logout}
            title="退出登录"
            onClick={() => {
              removeCookie("email", { path: "/" });
              history.push("/backend/login");
            }}>
            <svg
              height="24px"
              viewBox="0 -960 960 960"
              width="24px"
              fill="#5f6368">
              <path d="M200-120q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h240q17 0 28.5 11.5T480-800q0 17-11.5 28.5T440-760H200v560h240q17 0 28.5 11.5T480-160q0 17-11.5 28.5T440-120H200Zm487-320H400q-17 0-28.5-11.5T360-480q0-17 11.5-28.5T400-520h287l-75-75q-11-11-11-27t11-28q11-12 28-12.5t29 11.5l143 143q12 12 12 28t-12 28L669-309q-12 12-28.5 11.5T612-310q-11-12-10.5-28.5T613-366l74-74Z" />
            </svg>
            退出登录
          </div>
        </nav>
      </aside>
    </div>
  );
}
