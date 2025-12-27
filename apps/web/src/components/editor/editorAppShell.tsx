"use client";

import { Box, Flex, Group, Paper } from "@mantine/core";
import React, { lazy, Suspense } from "react";
import Topbar from "./topbar";
import { useEditorAiWindowStore } from "@/store/editor";
import LazyMount from "../lazyMount";
import RequireRole from "../auth/requireRole";
import { routesQueries } from "@/query/routerQuery";
import { useParams } from "next/navigation";

const AiChatDrawerLazy = lazy(() => import("./aiChatDrawer"));

const EditorAppShell = ({ children }: { children: React.ReactNode }) => {
  const { opened: aiWindowOpened, toggle: toggleAiWindow } =
    useEditorAiWindowStore();
  const { id } = useParams();
  const { data: route } = routesQueries.getById.useQuery(id?.toString() || "");
  const projectId = route?.projectId || "";

  return (
    <Group
      style={{
        overflow: "hidden",
        position: "relative",
        height: "100vh",
        width: "100vw",
      }}
    >
      <Group
        style={{
          overflow: "hidden",
          position: "relative",
          height: "100vh",
          width: aiWindowOpened ? "70vw" : "100vw",
          transition: "width 0.2s ease-in-out",
        }}
      >
        <Flex
          direction={"column"}
          h={"100vh"}
          style={{ overflow: "hidden", zIndex: 10 }}
          w={"100%"}
        >
          <Topbar />
          <Box flex={1}>{children}</Box>
        </Flex>
      </Group>
      <Box
        w={"30vw"}
        h={"100vh"}
        style={{
          position: "absolute",
          right: 0,
          transition: "transform 0.2s ease-in-out",
          transform: aiWindowOpened ? "translateX(0)" : "translateX(30vw)",
        }}
      >
        <LazyMount shouldMountOnce>
          <Suspense>
            <Paper shadow="md" h={"100vh"} w={"100%"}>
              <RequireRole requiredRole="creator" projectId={projectId}>
                <AiChatDrawerLazy />
              </RequireRole>
            </Paper>
          </Suspense>
        </LazyMount>
      </Box>
    </Group>
  );
};

export default EditorAppShell;
