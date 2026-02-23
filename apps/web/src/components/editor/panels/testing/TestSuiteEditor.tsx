import React, { useState, useEffect, useMemo } from "react";
import {
  Box,
  Button,
  Group,
  Stack,
  Text,
  Badge,
  Loader,
  Paper,
  ScrollArea,
  Menu,
  ActionIcon,
  Divider,
  TextInput,
  Textarea,
} from "@mantine/core";
import { TbCheck, TbPlus } from "react-icons/tb";
import UrlBar from "./components/UrlBar";
import RequestConfig from "./components/RequestConfig";
import AssertionsList from "./components/AssertionsList";
import MockDataEditor from "./components/MockDataEditor";
import TestSuiteHeader from "./components/TestSuiteHeader";
import { TestSuite, Assertion } from "./types";
import { notifications } from "@mantine/notifications";
import { testSuitesQueries } from "@/query/testSuitesQuery";
import { useQueryClient } from "@tanstack/react-query";
import FormDialog from "../../../dialog/formDialog";
import ConfirmDialog from "../../../dialog/confirmDialog";
import z from "zod";
import { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/routes/get-by-id/dto";

interface TestSuiteEditorProps {
  suiteId: string;
  route: z.infer<typeof getByIdResponseSchema>;
  onDeleted: () => void;
}

const TestSuiteEditor = ({
  suiteId,
  route,
  onDeleted,
}: TestSuiteEditorProps) => {
  const queryClient = useQueryClient();
  const { data: suite, isLoading: isSuiteLoading } =
    testSuitesQueries.getById.useQuery(suiteId);
  const updateSuite = testSuitesQueries.update.useMutation();
  const deleteSuite = testSuitesQueries.delete.useMutation();
  const runSuiteAction = testSuitesQueries.run.useMutation();

  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [editingSuiteName, setEditingSuiteName] = useState("");
  const [editingSuiteDesc, setEditingSuiteDesc] = useState("");

  const [running, setRunning] = useState(false);
  const [ran, setRan] = useState(false);
  const [pathParams, setPathParams] = useState<Record<string, string>>({});
  const [queryParams, setQueryParams] = useState<Record<string, string>>({});
  const [headers, setHeaders] = useState<Record<string, string>>({
    "Content-Type": "application/json",
  });
  const [body, setBody] = useState<string>("{\n  \n}");
  const [mockData, setMockData] = useState<string>(`{
  "test_user_id": 123,
  "override_token": "mock-jwt-token-789"
}`);
  const [assertions, setAssertions] = useState<any[]>([]);

  useEffect(() => {
    if (!suite) {
      return;
    }
    if (Object.keys(suite.routeParams).length > 0) {
      setPathParams(suite.routeParams || {});
    }
    setQueryParams(suite.queryParams || {});
    setHeaders(suite.headers || { "Content-Type": "application/json" });
    setBody(
      typeof suite.body === "string"
        ? suite.body
        : JSON.stringify(suite.body || {}, null, 2),
    );

    const mappedAssertions = (suite.assertions || []).map((a: any) => ({
      id: a.id || Math.random().toString(),
      target: a.target,
      path: a.property_path,
      operator: a.operator,
      expected: a.expected_value,
      customJs: a.custom_js,
      message: a.message,
      success: a.success,
    }));
    setAssertions(mappedAssertions.length > 0 ? mappedAssertions : []);
    setRan(false);
  }, [suite]);

  useEffect(() => {
    const params = route.path.match(/:[a-zA-Z0-9_]+/g);
    if (params) {
      const initial: Record<string, string> = {};
      params.forEach((p: string) => {
        initial[p.substring(1)] = "";
      });
      setPathParams(initial);
    }
  }, [route.path]);

  const resolvedUrl = useMemo(() => {
    let finalPath = route.path;
    Object.entries(pathParams).forEach(([key, value]) => {
      finalPath = finalPath.replace(`:${key}`, value || `:${key}`);
    });

    const searchParams = new URLSearchParams();
    Object.entries(queryParams).forEach(([key, value]) => {
      if (key) searchParams.append(key, value);
    });

    const qs = searchParams.toString();
    return `${window.location.origin}${finalPath}${qs ? `?${qs}` : ""}`;
  }, [route.path, pathParams, queryParams]);

  const handleSaveData = async (showNotification = true) => {
    let parsedBody;
    try {
      parsedBody = JSON.parse(body);
    } catch {
      parsedBody = body;
    }
    await updateSuite.mutateAsync({
      id: suiteId,
      data: {
        routeParams: pathParams,
        queryParams,
        headers,
        body: parsedBody,
        assertions: assertions.map((a) => ({
          target: a.target,
          property_path: a.path,
          operator: a.target === "custom_js" ? undefined : a.operator,
          expected_value:
            a.target === "custom_js" ? undefined : String(a.expected),
          custom_js: a.customJs,
        })),
      },
    });
    testSuitesQueries.getAll.invalidate(queryClient, route.id);

    if (showNotification) {
      notifications.show({
        title: "Success",
        id: "test-suite-saved",
        message: "Test suite saved successfully!",
        color: "green",
      });
    }
  };

  const handleRun = async () => {
    setRunning(true);
    setRan(false);
    try {
      await handleSaveData(false);
      const res = await runSuiteAction.mutateAsync(suiteId);

      const updatedAssertions = assertions.map((a, i) => ({
        ...a,
        success: res.result?.[i]?.success,
        message: res.result?.[i]?.message,
      }));
      setAssertions(updatedAssertions);

      setRan(true);
      if (res.success) {
        notifications.show({
          id: "test-suite-run",
          title: "Success",
          message: "All assertions passed!",
          color: "green",
        });
      } else {
        notifications.show({
          id: "test-suite-run",
          title: "Failed",
          message: "Some assertions failed.",
          color: "red",
        });
      }
    } catch (e: any) {
      notifications.show({
        id: "test-suite-run",
        title: "Error",
        message: "Failed to run test suite.",
        color: "red",
      });
    } finally {
      setRunning(false);
    }
  };

  const addAssertion = () => {
    setAssertions([
      ...assertions,
      {
        id: Math.random().toString(),
        target: "body",
        operator: "equals",
        expected: "",
      },
    ]);
  };

  const isMockDataDisabled = ["GET", "DELETE"].includes(
    route.method.toUpperCase(),
  );

  return (
    <Box
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        backgroundColor: "white",
        overflow: "hidden",
      }}
    >
      {isSuiteLoading && (
        <Box
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(255, 255, 255, 0.7)",
            zIndex: 10,
          }}
        >
          <Loader color="violet" />
        </Box>
      )}

      <TestSuiteHeader
        suiteName={suite?.name || ""}
        suiteDescription={suite?.description || ""}
        status={
          ran
            ? assertions.every((a) => a.success !== false)
              ? "passed"
              : "failed"
            : null
        }
        running={running}
        isSaving={updateSuite.isPending}
        onRun={handleRun}
        onSave={handleSaveData}
        onEdit={() => {
          setEditingSuiteName(suite?.name || "");
          setEditingSuiteDesc(suite?.description || "");
          setIsEditDialogOpen(true);
        }}
        onDelete={() => setIsDeleteDialogOpen(true)}
      />

      {/* Content - Scrollable area */}
      <Box
        style={{
          flex: 1,
          position: "relative",
          minHeight: 0,
          overflow: "hidden",
        }}
      >
        <Box
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            overflowY: "auto",
          }}
        >
          <Box p="xl" maw={1000} mx="auto">
            <Stack gap={40} pb={80}>
              {" "}
              {/* Added significant bottom padding */}
              {/* URL Section */}
              <Box>
                <UrlBar method={route.method} path={route.path} />
                <Box mt="xs" px={4}>
                  <Text
                    size="11px"
                    c="dimmed"
                    fw={500}
                    style={{ fontFamily: "monospace", wordBreak: "break-all" }}
                  >
                    Preview:{" "}
                    <span style={{ color: "#7950F2" }}>{resolvedUrl}</span>
                  </Text>
                </Box>
              </Box>
              {/* Request Config Section */}
              <Box>
                <Text size="sm" fw={700} mb="lg" c="gray.8">
                  Request Configuration
                </Text>
                <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
                  <RequestConfig
                    method={route.method}
                    pathParams={pathParams}
                    onPathParamsChange={setPathParams}
                    queryParams={queryParams}
                    onQueryParamsChange={setQueryParams}
                    headers={headers}
                    onHeadersChange={setHeaders}
                    body={body}
                    onBodyChange={setBody}
                  />
                </Paper>
              </Box>
              <Divider color="gray.1" />
              {!isMockDataDisabled && (
                <MockDataEditor mockData={mockData} onChange={setMockData} />
              )}
              {/* Assertions Section */}
              <Box>
                <Group justify="space-between" mb="sm">
                  <Group gap="sm">
                    <TbCheck size={18} color="#10B981" />
                    <Text size="sm" fw={700} c="gray.8">
                      Assertions
                    </Text>
                  </Group>
                  <Button
                    variant="subtle"
                    color="violet"
                    size="xs"
                    leftSection={<TbPlus size={14} />}
                    onClick={addAssertion}
                  >
                    Add Assertion
                  </Button>
                </Group>
                <AssertionsList
                  assertions={assertions}
                  onChange={setAssertions}
                  ran={ran}
                />
              </Box>
            </Stack>
          </Box>
        </Box>
      </Box>

      {/* Edit Dialog */}
      <FormDialog
        title="Edit Test Suite"
        open={isEditDialogOpen}
        onClose={() => setIsEditDialogOpen(false)}
      >
        <Stack>
          <TextInput
            label="Name"
            required
            value={editingSuiteName}
            onChange={(e) => setEditingSuiteName(e.currentTarget.value)}
          />
          <Textarea
            label="Description"
            value={editingSuiteDesc}
            onChange={(e) => setEditingSuiteDesc(e.currentTarget.value)}
          />
          <Button
            color="violet"
            fullWidth
            onClick={async () => {
              if (!editingSuiteName) return;
              await updateSuite.mutateAsync({
                id: suiteId,
                data: { name: editingSuiteName, description: editingSuiteDesc },
              });
              testSuitesQueries.getAll.invalidate(queryClient, route.id);
              testSuitesQueries.getById.invalidate(queryClient, suiteId);
              setIsEditDialogOpen(false);
            }}
            disabled={!editingSuiteName}
            loading={updateSuite.isPending}
          >
            Save Changes
          </Button>
        </Stack>
      </FormDialog>

      {/* Delete Dialog */}
      <ConfirmDialog
        title="Delete Test Suite"
        open={isDeleteDialogOpen}
        onClose={() => setIsDeleteDialogOpen(false)}
        onConfirm={async () => {
          await deleteSuite.mutateAsync(suiteId);
          testSuitesQueries.getAll.invalidate(queryClient, route.id);
          setIsDeleteDialogOpen(false);
          onDeleted();
        }}
        confirmColor="red"
        confirmText="Delete"
      >
        <Box p="xs">
          Are you sure you want to delete <b>{suite?.name}</b>? This action
          cannot be undone.
        </Box>
      </ConfirmDialog>
    </Box>
  );
};

export default TestSuiteEditor;
