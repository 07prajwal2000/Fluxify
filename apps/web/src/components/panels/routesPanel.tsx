"use client";

import { Box, Stack } from "@mantine/core";
import React, { useEffect } from "react";
import RouteItem from "../routeItem";
import { routesQueries } from "@/query/routerQuery";
import { useRouterPagination } from "@/store/routes";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { useQueryClient } from "@tanstack/react-query";
import EmptyRoutePanel from "./emptyRoutePanel";

type PropTypes = {
  projectId?: string;
};

const RoutesPanel = (props: PropTypes) => {
  const { page, perPage, setPaginationLimit } = useRouterPagination();
  const { useQuery, invalidate } = routesQueries.getAll;
  const { data, isLoading, isError, error } = useQuery({
    page,
    perPage,
    filter: {
      field: props.projectId ? "projectId" : "",
      operator: "eq",
      value: props.projectId ? props.projectId : "",
    },
  });
  const client = useQueryClient();

  useEffect(() => {
    if (isError || isLoading || !data?.data) return;
    setPaginationLimit(data.pagination.totalPages);
  }, [data]);

  if (isLoading)
    return (
      <Box w={"100%"} mt={"xl"}>
        <QueryLoader type="spinner" skeletonsRows={6} />
      </Box>
    );

  if (isError) {
    return (
      <QueryError
        error={error!}
        refetcher={() => {
          invalidate(client);
        }}
      />
    );
  }

  return (
    <Stack w={"100%"} py={"xs"} gap={"xs"} h={"100%"}>
      {data?.data.map((route) => (
        <RouteItem
          key={route.id}
          id={route.id}
          name={route.name!}
          method={route.method!}
          path={route.path!}
          updatedAt={route.updatedAt}
          createdAt={route.createdAt}
          active={route.active!}
          projectName={route.projectName!}
          projectId={route.projectId!}
        />
      ))}
      {data?.data.length === 0 && <EmptyRoutePanel />}
    </Stack>
  );
};

export default RoutesPanel;
