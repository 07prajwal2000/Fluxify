import OverviewTabs from "@/components/overviewTabs";
import ProjectPageOverview from "@/components/panels/projectPageOverview";
import ProjectSettings from "@/components/project/settings";
import { authClient } from "@/lib/auth";
import type { AccessControlRole } from "@fluxify/server/src/db/schema";
import { canAccessProject, roleHierarchy } from "@fluxify/server/src/lib/acl";
import { Stack } from "@mantine/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

const Page = async (params: any) => {
  const { projectId } = await params.params;
  const headersList = await headers();
  const session = await authClient.getSession({
    fetchOptions: { headers: headersList },
  });
  if (!session.data?.user) {
    redirect("/login");
  }
  const hasAccess = canAccessProject(
    (session.data as any).acl,
    projectId,
    "viewer"
  );
  if (!hasAccess) {
    redirect("/");
  }

  const role = (session.data as any).acl.filter(
    (entry: any) => entry.projectId === projectId || entry.projectId === "*"
  )[0].role;
  const showTabs =
    roleHierarchy[role as AccessControlRole] >= roleHierarchy["creator"];
  return (
    <Stack style={{ height: "100vh" }} p={"lg"}>
      <ProjectPageOverview projectId={projectId} />
      <OverviewTabs
        tabs={showTabs ? extraTabs : undefined}
        projectId={projectId}
      />
    </Stack>
  );
};
const disableNpm = process.env.DISABLE_NPM;

const extraTabs = [
  {
    label: "Settings",
    value: "settings",
    content: <ProjectSettings disableNpm={disableNpm === "true"} />,
  },
];

export default Page;
