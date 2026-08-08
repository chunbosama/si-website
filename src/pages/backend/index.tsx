import { useEffect } from "react";
import { useCookies } from "react-cookie";

import { useHistory } from "@docusaurus/router";
import Dashbroad from "@site/src/components/backend/Dashbroad";
import EconomyManager from "@site/src/components/backend/EconomyManager";
import Layout from "@site/src/components/backend/Layout";
import QAManager from "@site/src/components/backend/QAManager";
import VoteResult from "@site/src/components/backend/VoteResult";
import SignUpManager from "@site/src/components/backend/SignUpManager";
import MemberManager from "@site/src/components/backend/MemberManager";
import SigninManager from "@site/src/components/backend/SigninManager";
import LiveManager from "@site/src/components/backend/LiveManager";
import BlogManager from "@site/src/components/backend/BlogManager";
import CodeManager from "@site/src/components/backend/CodeManager";
import LuckyDrawManager from "@site/src/components/backend/LuckyDrawManager";
import GalleryManager from "@site/src/components/backend/GalleryManager";

export default function Backend() {
  const [cookie] = useCookies();
  const isLogon = cookie.email;

  const history = useHistory();

  useEffect(() => {
    if (!isLogon) {
      history.push("/backend/login");
    }
  }, []);

  return (
    <Layout showIfLogon={true}>
      <Dashbroad key={0} />
      <EconomyManager key={1} />
      <QAManager key={2} />
      <VoteResult key={3} />
      <SignUpManager key={4} />
      <MemberManager key={5} />
      <SigninManager key={6} />
      <LiveManager key={7} />
      <BlogManager key={8} />
      <CodeManager key={9} />
      <LuckyDrawManager key={10} />
      <GalleryManager key={11} />
    </Layout>
  );
}
