"use client";

import React, { useState } from "react";
import {
  Box,
  Stack,
  TextInput,
  Textarea,
  Button,
  Accordion,
  Modal,
  Text,
  ThemeIcon,
  List,
  Alert,
} from "@mantine/core";
import { TbX, TbAlertCircle } from "react-icons/tb";
import { useParams } from "next/navigation";
import { routesQueries } from "@/query/routerQuery";
import QueryLoader from "../../query/queryLoader";
import QueryError from "../../query/queryError";
import Sidebar from "./testing/Sidebar";
import Playground from "./testing/Playground";
import TestSuiteEditor from "./testing/TestSuiteEditor";
import TestSummaryModal from "./testing/components/TestSummaryModal";
import FormDialog from "../../dialog/formDialog";
import ConfirmDialog from "../../dialog/confirmDialog";
import { testSuitesQueries } from "@/query/testSuitesQuery";
import { useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";

export type TestSuite = {
  id: string;
  name: string;
  description: string;
};

const TestingPanel = () => {
  const { routeId } = useParams<{ routeId: string }>();
  const queryClient = useQueryClient();
  const {
    data: route,
    isLoading,
    isError,
    error,
    refetch,
  } = routesQueries.getById.useQuery(routeId);

  const { data: testSuitesList } = testSuitesQueries.getAll.useQuery(routeId);
  const testSuites = (testSuitesList || []) as any[];

  const [activeView, setActiveView] = useState<"playground" | string>(
    "playground",
  );

  const createSuite = testSuitesQueries.create.useMutation();
  const updateSuite = testSuitesQueries.update.useMutation();
  const deleteSuite = testSuitesQueries.delete.useMutation();
  const runAllSuiteAction = testSuitesQueries.runAll.useMutation();

  // Dialog states
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [newSuite, setNewSuite] = useState({ name: "", description: "" });

  const [isTestSummaryOpen, setIsTestSummaryOpen] = useState(false);
  const [summarySuites, setSummarySuites] = useState<
    { 
      name?: string; 
      success?: boolean;
      errors?: string[]; 
      assertions?: { success: boolean, message: string }[];
      actualData?: unknown; 
    }[]
  >([]);

  const handleAddSuite = async () => {
    if (!newSuite.name) return;
    const res = await createSuite.mutateAsync({
      name: newSuite.name,
      description: newSuite.description,
      routeId: route?.id,
      assertions: [],
    });
    testSuitesQueries.getAll.invalidate(queryClient, routeId);
    setActiveView(res.id);
    setNewSuite({ name: "", description: "" });
    setIsAddDialogOpen(false);
  };

  if (isLoading) return <QueryLoader />;
  if (isError) return <QueryError error={error} refetcher={refetch} />;
  if (!route) return null;

  const activeSuite = testSuites.find((s) => s.id === activeView);

  return (
    <Box
      h="100%"
      bg="gray.0"
      style={{
        display: "flex",
        overflow: "hidden",
        position: "relative",
        zIndex: 1,
      }}
    >
      <Sidebar
        activeId={activeView}
        onSelect={setActiveView}
        suites={testSuites}
        onAddClick={() => setIsAddDialogOpen(true)}
        onRunAllClick={async () => {
          try {
            const res = await runAllSuiteAction.mutateAsync(route.id);
            if (res.success) {
              notifications.show({
                title: "Success",
                message: "All test suites passed!",
                color: "green",
              });
            } else {
              notifications.show({
                title: "Failed",
                message: "Some test suites failed their assertions.",
                color: "red",
              });
            }
            if (res.result && res.result.length > 0) {
              setSummarySuites(res.result);
              setIsTestSummaryOpen(true);
            }
          } catch (e: any) {
            notifications.show({
              title: "Error",
              message: "Failed to run all test suites.",
              color: "red",
            });
          }
        }}
        isRunAllLoading={runAllSuiteAction.isPending}
      />

      <Box
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          position: "relative",
          overflow: "hidden",
          minWidth: 0,
          height: "100%",
        }}
      >
        {activeView === "playground" ? (
          <Playground route={route} />
        ) : (
          <TestSuiteEditor
            suiteId={activeView}
            route={route}
            onDeleted={() => setActiveView("playground")}
          />
        )}
      </Box>

      {/* Add Dialog */}
      <FormDialog
        title="Create New Test Suite"
        open={isAddDialogOpen}
        onClose={() => setIsAddDialogOpen(false)}
      >
        <Stack>
          <TextInput
            label="Name"
            placeholder="e.g., Auth Flow Validation"
            required
            value={newSuite.name}
            onChange={(e) =>
              setNewSuite({ ...newSuite, name: e.currentTarget.value })
            }
          />
          <Textarea
            label="Description"
            placeholder="Briefly describe what this suite tests..."
            value={newSuite.description}
            onChange={(e) =>
              setNewSuite({ ...newSuite, description: e.currentTarget.value })
            }
          />
          <Button
            color="violet"
            fullWidth
            onClick={handleAddSuite}
            disabled={!newSuite.name}
            loading={createSuite.isPending}
          >
            Create Suite
          </Button>
        </Stack>
      </FormDialog>

      <TestSummaryModal
        opened={isTestSummaryOpen}
        onClose={() => setIsTestSummaryOpen(false)}
        suites={summarySuites}
      />
    </Box>
  );
};

export default TestingPanel;
