import { routesQueries } from "@/query/routerQuery";
import { Switch } from "@mantine/core";
import { useParams } from "next/navigation";
import React, { useEffect, useState } from "react";
import QueryLoader from "../query/queryLoader";
import { useQueryClient } from "@tanstack/react-query";
import { routesService } from "@/services/routes";
import { showErrorNotification } from "@/lib/errorNotifier";
import { notifications } from "@mantine/notifications";

type Props = {
  routeId: string;
  showToggleNotifications?: boolean;
};

const ActiveToggle = (props: Props) => {
  const { useQuery, invalidate } = routesQueries.getById;
  const client = useQueryClient();
  const { data, isLoading, isError } = useQuery(props.routeId);
  const [active, setActive] = useState(data?.active || false);

  useEffect(() => {
    setActive(data?.active || false);
  }, [data?.active]);

  if (isLoading) {
    return <QueryLoader skeletonsCols={1} skeletonsRows={1} />;
  }

  if (isError || !data) {
    return "";
  }

  async function toggleActive() {
    const loaderId = crypto.randomUUID();
    try {
      props.showToggleNotifications &&
        notifications.show({
          id: loaderId,
          loading: true,
          message: active ? "Deactivating..." : "Activating...",
          withCloseButton: false,
          color: "violet",
        });
      setActive((p) => !p);
      await routesService.updatePartial(props.routeId, { active: !active });
      routesQueries.getById.invalidate(client, props.routeId);
      routesQueries.getAll.invalidate(client);
      props.showToggleNotifications &&
        notifications.update({
          id: loaderId,
          loading: false,
          message: active ? "Deactivated" : "Activated",
          color: "green",
          withCloseButton: true,
        });
    } catch (error: any) {
      setActive((p) => !p);
      showErrorNotification(error);
      props.showToggleNotifications &&
        notifications.update({
          id: loaderId,
          loading: false,
          withCloseButton: true,
          message: "Failed to " + (active ? "deactivate" : "activate"),
          color: "red",
        });
    }
  }

  return (
    <Switch
      labelPosition="right"
      label={active ? "Active" : "Inactive"}
      onChange={toggleActive}
      checked={active}
      color="violet"
    />
  );
};

export default ActiveToggle;
