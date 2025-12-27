"use client";

import { Group, Tabs } from "@mantine/core";
import React, { useState } from "react";
import RoutesPanel from "./panels/routesPanel";
import RouterFilter from "./filters/routerFilter";
import RouterPagination from "./filters/routerPagination";
import RequireRole from "./auth/requireRole";
import RequireRoleInAnyProject from "./auth/requireRoleInAnyProject";

type PropTypes = {
  tabs?: {
    label: string;
    content: React.ReactNode;
  }[];
  projectId?: string;
};

const OverviewTabs = (props: PropTypes) => {
  const [selectedTab, setSelectedTab] = useState("routes");
  return (
    <Tabs
      style={{
        flex: 1,
        overflowY: "auto",
        display: "flex",
        flexDirection: "column",
      }}
      color="violet"
      value={selectedTab}
      onChange={(e) => setSelectedTab(e!)}
    >
      <Group
        style={{ position: "sticky", top: 0, zIndex: 100 }}
        w={"100%"}
        bg={"white"}
        gap={0}
      >
        <Tabs.List>
          <Tabs.Tab value={"routes"}>Routes</Tabs.Tab>
          {props.projectId ? (
            <RequireRole projectId={props.projectId} requiredRole="creator">
              <Tabs.Tab value={"executions"}>Executions</Tabs.Tab>
            </RequireRole>
          ) : (
            <RequireRoleInAnyProject requiredRole="creator">
              <Tabs.Tab value={"executions"}>Executions</Tabs.Tab>
            </RequireRoleInAnyProject>
          )}
          {props.tabs?.map((tab, index) => (
            <Tabs.Tab key={index} value={tab.label}>
              {tab.label}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {selectedTab === "routes" && (
          <Group ml={"auto"}>
            <RouterPagination />
            <RouterFilter />
          </Group>
        )}
      </Group>
      <Tabs.Panel value="routes">
        <RoutesPanel projectId={props.projectId} />
      </Tabs.Panel>
      <Tabs.Panel value="executions">Executions panel</Tabs.Panel>
      {props.tabs?.map((tab, index) => (
        <Tabs.Panel key={index} value={tab.label}>
          {tab.content}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
};

export default OverviewTabs;
