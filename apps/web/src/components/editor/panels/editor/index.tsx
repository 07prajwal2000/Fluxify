"use client";
import { Box } from "@mantine/core";
import React from "react";
import BlockCanvas from "./blockCanvas";
import { ReactFlowProvider } from "@xyflow/react";
import { useParams } from "next/navigation";

const EditorPanel = () => {
  const { id } = useParams<{ id: string }>();
  return (
    <Box style={{ overflow: "hidden", position: "relative" }} h={"100%"}>
      <ReactFlowProvider>
        <BlockCanvas routeId={id} />
      </ReactFlowProvider>
    </Box>
  );
};

export default EditorPanel;
