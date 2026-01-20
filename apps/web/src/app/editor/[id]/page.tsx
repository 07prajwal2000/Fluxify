import EditorAppShell from "@/components/editor/editorAppShell";
import EditorWindow from "@/components/editor/editorWindow";
import { authClient } from "@/lib/auth";
import { canAccess } from "@fluxify/server/src/lib/acl";
import { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

export const metadata: Metadata = {
  title: "Editor | Configurable Backend Engine",
  description: "CBE Editor",
};

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
  return (
    <EditorAppShell>
      <EditorWindow />;
    </EditorAppShell>
  );
};

export default Page;
