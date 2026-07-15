"use server";
import EditRouteSettings from "@/components/forms/EditRouteSettings";
import { authClient } from "@/lib/auth";
import { canAccess } from "@fluxify/server/src/lib/acl";
import { Stack } from "@mantine/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

const Page = async ({ params }: { params: Promise<{ projectId: string; routeId: string }> }) => {
  const resolvedParams = await params;
  const routeId = resolvedParams.routeId;
  const projectId = resolvedParams.projectId;

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
    <Stack p={"xs"} h="100%">
      <EditRouteSettings routeId={routeId} projectId={projectId} />
    </Stack>
  );
};

export default Page;
