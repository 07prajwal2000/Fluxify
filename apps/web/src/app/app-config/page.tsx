import AppConfigList from "@/components/panels/appConfigList";
import { AppConfigProvider } from "@/context/appConfigPage";
import { authClient } from "@/lib/auth";
import { canAccess } from "@fluxify/server/src/lib/acl";
import { Stack, Text } from "@mantine/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import React from "react";

const Page = async () => {
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
    <AppConfigProvider>
      <Stack px={"xs"}>
        <Stack gap={0}>
          <Text fw={"500"} size="2em">
            App Configuration
          </Text>
          <Text size="sm" c={"gray"}>
            A list of all secrets, configurations and variables are here
          </Text>
        </Stack>
        <AppConfigList />
      </Stack>
    </AppConfigProvider>
  );
};

export default Page;
