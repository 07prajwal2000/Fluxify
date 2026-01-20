"use client";
import { Box } from "@mantine/core";
import React from "react";
import BlockCanvas from "./blockCanvas";
import { ReactFlowProvider } from "@xyflow/react";
import { useParams } from "next/navigation";
import { canAccessProject } from "@fluxify/server/src/lib/acl";

const EditorPanel = () => {
  const { id } = useParams<{ id: string }>();
  // TODO: need to implemennt readonly for viewer access // canAccessProject()
  return (
    <Box style={{ overflow: "hidden", position: "relative" }} h={"100%"}>
      <ReactFlowProvider>
        <BlockCanvas routeId={id} readonly={false} />
      </ReactFlowProvider>
    </Box>
  );
};

export default EditorPanel;
