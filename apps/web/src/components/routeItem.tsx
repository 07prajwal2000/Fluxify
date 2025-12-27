import {
  ActionIcon,
  Card,
  Center,
  Grid,
  Group,
  Paper,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import React, { useState } from "react";
import HttpMethodText from "./httpMethodText";
import { getTimeAgo } from "@/lib/datetime";
import RouteItemMenu from "./routeItemMenu";
import { useRouter } from "next/navigation";
import { routesQueries } from "@/query/routerQuery";
import { routesService } from "@/services/routes";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { TbStack2, TbUser } from "react-icons/tb";
import RequireRole from "./auth/requireRole";

type Proptypes = {
  id: string;
  name: string;
  method: string;
  path: string;
  updatedAt: string;
  createdAt: string;
  projectName: string;
  projectId: string;
  active: boolean;
};

const RouteItem = (props: Proptypes) => {
  const [active, setActive] = useState(props.active);
  const client = useQueryClient();
  const router = useRouter();

  async function toggleActive() {
    const loaderId = crypto.randomUUID();
    try {
      notifications.show({
        id: loaderId,
        loading: true,
        message: active ? "Deactivating..." : "Activating...",
        withCloseButton: false,
        color: "violet",
      });
      await routesService.updatePartial(props.id, {
        active: !active,
      });
      routesQueries.invalidateAll(client);
      setActive((p) => !p);
      notifications.update({
        id: loaderId,
        loading: false,
        message: active ? "Deactivated" : "Activated",
        color: "green",
        withCloseButton: true,
      });
    } catch (error) {
      notifications.update({
        id: loaderId,
        loading: false,
        withCloseButton: true,
        message: "Something went wrong",
        color: "red",
      });
    } finally {
      setTimeout(() => notifications.hide(loaderId), 3_000);
    }
  }

  function onItemClick() {
    router.push(`/editor/${props.id}`);
  }

  const projectName = props.projectName;

  return (
    <Card shadow="md" p={"xs"} withBorder>
      <Grid>
        <Grid.Col
          onClick={onItemClick}
          style={{ cursor: "pointer" }}
          my={"auto"}
          h={"100%"}
          span={1}
        >
          <Center dir="">
            <HttpMethodText method={props.method as any} />
          </Center>
        </Grid.Col>
        <Grid.Col onClick={onItemClick} style={{ cursor: "pointer" }} span={8}>
          <Stack gap={4}>
            <Text>{props.name}</Text>
            <Group gap={"xs"}>
              <Text size="xs" c={"gray"}>
                Updated {getTimeAgo(props.updatedAt)}
              </Text>
              <Text size="xs" c={"gray"}>
                |
              </Text>
              <Text size="xs" c={"gray"}>
                Created {getTimeAgo(props.createdAt)}
              </Text>
            </Group>
          </Stack>
        </Grid.Col>
        <Grid.Col span={3}>
          <Group my={"auto"} h={"100%"} gap={"lg"} justify="end">
            <Tooltip
              bg={"dark"}
              label={
                <Text size={"xs"}>Route associated with {projectName}</Text>
              }
            >
              <Paper shadow="sm" withBorder>
                <Group gap={"xs"} w={"fit-content"} px={"xs"} py={4} bdrs="sm">
                  <TbStack2 size={20} />
                  <Text size="xs">{projectName}</Text>
                </Group>
              </Paper>
            </Tooltip>
            <RequireRole projectId={props.projectId} requiredRole="creator">
              <Switch
                color="violet"
                label={active ? "Active" : "Inactive"}
                onChange={toggleActive}
                checked={active}
              />
              <RouteItemMenu id={props.id} />
            </RequireRole>
          </Group>
        </Grid.Col>
      </Grid>
    </Card>
  );
};

export default RouteItem;
