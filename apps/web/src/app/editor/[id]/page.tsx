import EditorWindow from "@/components/editor/editorWindow";
import { authClient } from "@/lib/auth";
import { canAccess } from "@fluxify/server/src/lib/acl";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

const Page = async () => {
  const headersList = await headers();
  const session = await authClient.getSession({
    fetchOptions: { headers: headersList },
  });
  if (!session.data?.user) {
    return redirect("/login");
  }
  const hasAccess = canAccess((session.data as any).acl, "viewer");
  if (!hasAccess) {
    return redirect("/");
  }
  return <EditorWindow />;
};

export default Page;
