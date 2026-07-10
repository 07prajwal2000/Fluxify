"use client";
import { Stack } from "@mantine/core";
import React from "react";
import AddNewBlockButton from "./toolbox/addNewBlockButton";
import AddStickyNoteButton from "./toolbox/addStickyNoteBlockButton";
import AiButton from "./toolbox/aiButton";
import { useFlowEditorContext } from "./flowEditorContext";

const EditorToolbox = () => {
  const { features } = useFlowEditorContext();
  return (
    <Stack align="center">
      {features.addBlockSidebar && <AddNewBlockButton />}
      {features.stickyNoteBtn && <AddStickyNoteButton />}
      {features.aiAssistant && <AiButton />}
    </Stack>
  );
};

export default EditorToolbox;
