"use client";
import { Group } from "@mantine/core";
import React from "react";
import UndoPanel from "./undoPanel";
import ZoomToolbox from "./zoomToolbox";
import FormatBlocksButton from "./formatBlocksButton";
import { useFlowEditorContext } from "../flowEditorContext";

const CanvasToolboxPanel = () => {
  const { features } = useFlowEditorContext();
  return (
    <Group>
      {features.zoomPanel && <ZoomToolbox />}
      <FormatBlocksButton />
      {features.undoRedo && <UndoPanel />}
    </Group>
  );
};

export default CanvasToolboxPanel;
