"use client";
import { Box } from "@mantine/core";
import React, { useEffect } from "react";
import BlockCanvas from "./blockCanvas";
import { ReactFlowProvider } from "@xyflow/react";
import { useEditorActionsStore } from "@/store/editor";

const FlowEditor = () => {
  const { disable, enable, reset } = useEditorActionsStore();

  useEffect(() => {
    disable();
    const timeout = setTimeout(() => {
      reset();
      enable();
    }, 100);
    return () => clearTimeout(timeout);
  }, [disable, enable, reset]);

  return (
    <Box style={{ overflow: "hidden", position: "relative" }} h={"100%"}>
      <ReactFlowProvider>
        <BlockCanvas />
      </ReactFlowProvider>
    </Box>
  );
};

export default FlowEditor;
