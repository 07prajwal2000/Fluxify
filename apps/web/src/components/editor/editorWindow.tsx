"use client";

import {
  EditorTab,
  useEditorActionsStore,
  useEditorChangeTrackerStore,
  useEditorStore,
  useEditorTabStore,
} from "@/store/editor";
import React, { useEffect } from "react";
import EditorPanel from "./panels/editor";
import ExecutionPanel from "./panels/executionPanel";
import TestingPanel from "./panels/testingPanel";
import { routesQueries } from "@/query/routerQuery";
import { useParams } from "next/navigation";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { useCanvasActionsStore } from "@/store/canvas";
import { useBlockDataActionsStore } from "@/store/blockDataStore";

const EditorWindow = () => {
  const resetStore = useEditorStore((state) => state.reset);
  const { bulkInsert } = useCanvasActionsStore();
  const { bulkInsert: bulkInsertBlockData, clearBlockData } =
    useBlockDataActionsStore();
  const { id } = useParams<{ id: string }>();
  const { useQuery } = routesQueries.getCanvasItems;
  const { data, isLoading, isError, error, refetch } = useQuery(id);
  const { reset: resetEditorActions } = useEditorActionsStore();
  const { reset: resetChangeTracker } = useEditorChangeTrackerStore();
  useEffect(() => {
    if (data) {
      bulkInsert(
        data.blocks as any,
        data.edges.map((edge) => ({
          id: edge.id,
          source: edge.from,
          target: edge.to,
          sourceHandle: edge.fromHandle,
          targetHandle: edge.toHandle,
          type: "custom",
        }))
      );
      bulkInsertBlockData(data.blocks);
    }
  }, [data]);
  useEffect(() => {
    return () => {
      resetStore();
      clearBlockData();
      resetEditorActions();
      resetChangeTracker();
    };
  }, []);

  const { activeTab } = useEditorTabStore();

  if (isLoading) {
    return <QueryLoader type="spinner" />;
  }

  if (isError) {
    return <QueryError error={error} refetcher={refetch} />;
  }

  if (activeTab === EditorTab.EDITOR) return <EditorPanel />;
  else if (activeTab === EditorTab.EXECUTIONS) return <ExecutionPanel />;
  return <TestingPanel />;
};

export default EditorWindow;
