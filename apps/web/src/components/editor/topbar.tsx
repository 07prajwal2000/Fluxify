import { Paper, Grid, Group, Box, Flex } from "@mantine/core";
import React from "react";
import TopbarEditorMoreOptions from "./topbarEditorMoreOptions";
import UpdateRouteNameField from "./updateRouteNameField";
import VersionHistoryButton from "./versionHistoryButton";
import SaveEditorButton from "./saveEditorButton";
import ActiveToggle from "./activeToggle";
import { useParams } from "next/navigation";
import EditorTopbarTabs from "./editorTopbarTabs";
import RequireRole from "../auth/requireRole";
import { routesQueries } from "@/query/routerQuery";

const Topbar = () => {
  const { id } = useParams();
  const { data: route } = routesQueries.getById.useQuery(id!.toString());
  const projectId = route?.projectId;
  return (
    <Paper style={{ zIndex: 10 }} shadow="sm" p={"sm"} pos={"relative"}>
      <Grid justify="space-between" align="center">
        <Box
          style={{
            position: "absolute",
            top: "0",
            bottom: "0",
            left: 0,
            right: 0,
          }}
        >
          <Flex
            justify="center"
            align="center"
            style={{ transform: "translateY(50%)" }}
          >
            <RequireRole projectId={projectId || ""} requiredRole="creator">
              <EditorTopbarTabs />
            </RequireRole>
          </Flex>
        </Box>
        <Grid.Col span={5}>
          <UpdateRouteNameField />
        </Grid.Col>
        <Grid.Col span={5}>
          <Group justify="end" gap={"xl"}>
            <RequireRole projectId={projectId || ""} requiredRole="creator">
              <ActiveToggle
                showToggleNotifications
                routeId={id?.toString() ?? ""}
              />
              <SaveEditorButton />
              <VersionHistoryButton />
              <TopbarEditorMoreOptions />
            </RequireRole>
          </Group>
        </Grid.Col>
      </Grid>
    </Paper>
  );
};

export default Topbar;
