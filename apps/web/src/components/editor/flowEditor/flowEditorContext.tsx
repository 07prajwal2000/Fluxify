"use client";
import React, { createContext, useContext } from "react";

export type FlowEditorFeatures = {
  undoRedo?: boolean;
  zoomPanel?: boolean;
  addBlockSidebar?: boolean;
  stickyNoteBtn?: boolean;
  aiAssistant?: boolean;
  keyboardAccessibility?: boolean;
};

export type FlowEditorContextType = {
  readonly: boolean;
  routeId?: string;
  projectId?: string;
  features: FlowEditorFeatures;
};

const FlowEditorContext = createContext<FlowEditorContextType | null>(null);

export const FlowEditorProvider = ({
  children,
  value,
}: {
  children: React.ReactNode;
  value: FlowEditorContextType;
}) => {
  return (
    <FlowEditorContext.Provider value={value}>
      {children}
    </FlowEditorContext.Provider>
  );
};

export const useFlowEditorContext = () => {
  const context = useContext(FlowEditorContext);
  if (!context) {
    throw new Error("useFlowEditorContext must be used within a FlowEditorProvider");
  }
  return context;
};
