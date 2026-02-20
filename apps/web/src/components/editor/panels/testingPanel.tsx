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
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const {
    data: route,
    isLoading,
    isError,
    error,
    refetch,
  } = routesQueries.getById.useQuery(id);

  const { data: testSuitesList } = testSuitesQueries.getAll.useQuery(id);
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

  const [isFailedAllDialogOpen, setIsFailedAllDialogOpen] = useState(false);
  const [failedAllSuites, setFailedAllSuites] = useState<
    { name?: string; errors?: string[] }[]
  >([]);

  const handleAddSuite = async () => {
    if (!newSuite.name) return;
    const res = await createSuite.mutateAsync({
      name: newSuite.name,
      description: newSuite.description,
      route_id: route?.id,
      assertions: [],
    });
    testSuitesQueries.getAll.invalidate(queryClient, id);
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
              if (res.result) {
                const failed = res.result.filter((r) => !r.success);
                if (failed.length > 0) {
                  setFailedAllSuites(failed);
                  setIsFailedAllDialogOpen(true);
                }
              }
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

      <Modal
        title={
          <Text fw={700} c="red.8" size="lg">
            Test Suites Failed
          </Text>
        }
        opened={isFailedAllDialogOpen}
        onClose={() => setIsFailedAllDialogOpen(false)}
        size="lg"
      >
        <Alert
          icon={<TbAlertCircle size={16} />}
          title={`${failedAllSuites.length} test suite(s) failed during execution.`}
          color="red"
          variant="light"
          mb="md"
        />
        <Accordion variant="separated" radius="md" chevronPosition="left">
          {failedAllSuites.map((suite, i) => (
            <Accordion.Item key={i} value={suite.name || `Suite ${i}`}>
              <Accordion.Control>
                <Text fw={600} size="sm">
                  {suite.name || "Unknown Suite"}
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <List
                  spacing="xs"
                  size="sm"
                  center
                  icon={
                    <ThemeIcon color="red" size={20} radius="xl">
                      <TbX size={12} />
                    </ThemeIcon>
                  }
                >
                  {(suite.errors || []).map((err, idx) => (
                    <List.Item key={idx}>
                      <Text size="sm" c="gray.8">
                        {err}
                      </Text>
                    </List.Item>
                  ))}
                  {(!suite.errors || suite.errors.length === 0) && (
                    <List.Item>
                      <Text size="sm" c="gray.5" fs="italic">
                        No detailed assertions provided or evaluated.
                      </Text>
                    </List.Item>
                  )}
                </List>
              </Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Modal>
    </Box>
  );
};

export default TestingPanel;
