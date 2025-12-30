import SettingsTabs from "@/components/settings/tabs";
import { authClient } from "@/lib/auth";
import { canAccess } from "@fluxify/server/src/lib/acl";
import { Box, Stack, Text } from "@mantine/core";
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
  const disableNpm = process.env.DISABLE_NPM;
  return (
    <Box p={"sm"}>
      <Stack>
        <Text size="2rem" fw={"500"} c="dark">
          Settings
        </Text>
        <SettingsTabs disableNpm={disableNpm === "true"} />
      </Stack>
    </Box>
  );
};

export default Page;
