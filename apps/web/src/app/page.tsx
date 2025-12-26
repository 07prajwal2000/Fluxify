import CreateNewMenu from "@/components/createNewMenu";
import OverviewTabs from "@/components/overviewTabs";
import { authClient } from "@/lib/auth";
import { Group, Stack, Text } from "@mantine/core";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

export default async function Home() {
  const headersList = await headers();
  const session = await authClient.getSession({
    fetchOptions: { headers: headersList },
  });
  if (!session.data?.user) {
    redirect("/login");
  }
  return (
    <Stack style={{ height: "100vh" }} p={"lg"}>
      <Group justify="space-between" align="center">
        <Stack gap={2}>
          <Text size={"3rem"}>Overview</Text>
          <Text c={"gray"} size={".5rem"}>
            All routes, execution history you have access to
          </Text>
        </Stack>
        <CreateNewMenu />
      </Group>
      <OverviewTabs />
    </Stack>
  );
}
