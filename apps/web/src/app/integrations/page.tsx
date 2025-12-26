import AddIntegrationButton from "@/components/buttons/addIntegrationButton";
import IntegrationFilter from "@/components/filters/integrationFilter";
import AvailableConnectors from "@/components/panels/availableConnectors";
import IntegrationsList from "@/components/panels/integrationsList";
import { Group, Stack, Text } from "@mantine/core";
import { authClient } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

const Page = async () => {
  const headersList = await headers();
  const session = await authClient.getSession({
    fetchOptions: { headers: headersList },
  });
  if (!session.data?.user) {
    redirect("/login");
  }
  return (
    <Stack h="100vh" py="xs" px="md" gap="lg">
      {/* Fixed Header */}
      <Group justify="space-between" align="center">
        <Stack gap="xs">
          <Text size="2rem" fw={500}>
            Integrations
          </Text>
          <Text size="sm" c="gray">
            Connect & Configure 3rd Party Services
          </Text>
        </Stack>
        <AddIntegrationButton />
      </Group>

      {/* Full-height 3-column layout */}
      <Group
        wrap="nowrap"
        align="stretch"
        flex={1}
        style={{ overflow: "hidden" }}
      >
        {/* Left Panel - Available Connectors (scrolls independently if tall) */}
        <Stack w="20%" h="100%" style={{ minWidth: 0, overflowY: "auto" }}>
          <AvailableConnectors />
        </Stack>

        {/* Center - Main Content: ONLY this scrolls */}
        <Stack
          flex={1}
          h="100%"
          style={{
            minWidth: 0,
            overflow: "hidden", // Important: prevent double scrollbars
            display: "flex",
            flexDirection: "column",
          }}
          bg="white"
        >
          {/* This inner container takes all available height and scrolls */}
          <Stack
            flex={1}
            style={{
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            <IntegrationsList />
          </Stack>
        </Stack>

        {/* Right Panel - Filter (scrolls independently if needed) */}
        <IntegrationFilter />
      </Group>
    </Stack>
  );
};

export default Page;
