import BackToEditorButton from "@/components/editor/backToEditorButton";
import { authClient } from "@/lib/auth";
import { canAccess } from "@fluxify/server/src/lib/acl";
import { Stack } from "@mantine/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

const Page = async ({ params }: { params: Promise<{ id: string }> }) => {
  const routeId = (await params).id;
  console.log(await params);

  const headersList = await headers();
  const session = await authClient.getSession({
    fetchOptions: { headers: headersList },
  });
  if (!session.data?.user) {
    redirect("/login");
  }
  const hasAccess = canAccess((session.data as any).acl, "creator");
  if (!hasAccess) {
    redirect("/");
  }
  return (
    <Stack p={"xs"}>
      <BackToEditorButton routeId={routeId} />
    </Stack>
  );
};

export default Page;
