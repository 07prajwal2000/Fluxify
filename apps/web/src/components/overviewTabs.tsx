"use client";

import { Group, Tabs } from "@mantine/core";
import React, { useEffect, useLayoutEffect, useMemo, useState } from "react";
import RoutesPanel from "./panels/routesPanel";
import RouterFilter from "./filters/routerFilter";
import RouterPagination from "./filters/routerPagination";
import RequireRole from "./auth/requireRole";
import RequireRoleInAnyProject from "./auth/requireRoleInAnyProject";
import { useRouter, useSearchParams } from "next/navigation";

type PropTypes = {
  tabs?: {
    label: string;
    content: React.ReactNode;
    value: string;
  }[];
  projectId?: string;
};

const OverviewTabs = (props: PropTypes) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [selectedTab, setSelectedTab] = useState("routes");
  function onTabChange(tab: string | null) {
    if (!tab) return;
    setSelectedTab(tab);
  }
  useEffect(() => {
    router.replace(`?tab=${selectedTab}`);
  }, [selectedTab]);
  useLayoutEffect(() => {
    const tab = searchParams.get("tab")?.toString() || "";
    const possibleTabs = ["routes", "executions"].concat(
      (props.tabs ?? []).map((x) => x.value)
    );
    if (!possibleTabs.includes(tab)) {
      setSelectedTab("routes");
    } else {
      setSelectedTab(tab);
    }
  }, []);
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
      onChange={onTabChange}
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
            <Tabs.Tab key={index} value={tab.value}>
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
        <Tabs.Panel key={index} value={tab.value}>
          {tab.content}
        </Tabs.Panel>
      ))}
    </Tabs>
  );
};

export default OverviewTabs;
