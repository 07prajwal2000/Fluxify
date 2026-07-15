"use client";
import React, { useState, useEffect, useMemo, useRef } from "react";
import { routesQueries } from "@/query/routerQuery";
import { routesService } from "@/services/routes";
import { Loader, Center, Box, Title, Text, Button, Group, Stack, TextInput, Select, Switch, Alert, Code, NavLink, Paper, Flex } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useQueryClient } from "@tanstack/react-query";
import { useForm } from "@mantine/form";
import { SchemaEditor } from "../editors/schemaEditor/SchemaEditor";
import { ValidationSchema, SchemaEditorRef, DataType } from "@/types/schemaEditor";
import { TbInfoCircle, TbDeviceFloppy } from "react-icons/tb";
import BackToEditorButton from "../editor/backToEditorButton";

export default function EditRouteSettings({ routeId, projectId }: { routeId: string; projectId: string }) {
  const { data: routeData, isLoading, error } = routesQueries.getById.useQuery(routeId);
  const client = useQueryClient();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"general" | "body" | "params" | "query">("general");

  // Form for General Info
  const generalForm = useForm({
    mode: "uncontrolled",
    initialValues: {
      name: "",
      path: "",
      method: "GET",
      active: false,
    },
    validate: {
      name: (value) => (value.length < 2 ? "Name must have at least 2 letters" : null),
      path: (value) => (!value.startsWith("/") ? "Path must start with /" : null),
    },
  });

  const [bodySchema, setBodySchema] = useState<ValidationSchema | undefined>(undefined);
  const [querySchema, setQuerySchema] = useState<ValidationSchema | undefined>(undefined);
  const [paramsSchema, setParamsSchema] = useState<ValidationSchema | undefined>(undefined);
  
  const [generatedParamsSchema, setGeneratedParamsSchema] = useState<ValidationSchema | null>(null);

  // Refs for SchemaEditors to trigger save internally
  const bodySchemaRef = useRef<SchemaEditorRef>(null);
  const querySchemaRef = useRef<SchemaEditorRef>(null);
  const paramsSchemaRef = useRef<SchemaEditorRef>(null);

  useEffect(() => {
    if (routeData) {
      generalForm.setValues({
        name: routeData.name,
        path: routeData.path,
        method: routeData.method,
        active: routeData.active,
      });
      setBodySchema(routeData.bodySchema as ValidationSchema);
      setQuerySchema((routeData.querySchema as ValidationSchema) || { dataType: "object", properties: [] });
      setParamsSchema(routeData.paramsSchema as ValidationSchema);
    }
  }, [routeData]);

  // Extract variables from path to auto-generate paramsSchema
  const pathValue = generalForm.getValues().path;
  const pathParams = useMemo(() => {
    return Array.from(pathValue.matchAll(/:([a-zA-Z0-9_]+)/g)).map((m) => m[1]);
  }, [pathValue]);

  const hasBody = ["POST", "PUT"].includes(generalForm.getValues().method);
  const hasParams = pathParams.length > 0;

  const paramTypeOverrides = useMemo(() => {
    return pathParams.reduce((acc, param) => {
      acc[param] = ["str", "int", "bool", "float"];
      return acc;
    }, {} as Record<string, DataType[]>);
  }, [pathParams]);

  useEffect(() => {
    if (routeData?.paramsSchema) {
      setParamsSchema(routeData.paramsSchema as ValidationSchema);
    } else {
      setGeneratedParamsSchema({
        dataType: "object",
        properties: pathParams.map((p) => ({
          key: p,
          dataType: "str",
          required: true,
        })),
      });
    }
  }, [pathParams, routeData?.paramsSchema]);

  const handleUpdate = async () => {
    const validation = generalForm.validate();
    if (validation.hasErrors) {
      notifications.show({
        title: "Validation Error",
        message: "Please fix the errors in General Info",
        color: "red",
      });
      return;
    }

    // Get schemas directly from refs to avoid waiting for async React state updates
    const currentBodySchema = bodySchemaRef.current?.getSchema() ?? bodySchema;
    const currentQuerySchema = querySchemaRef.current?.getSchema() ?? querySchema;
    const currentParamsSchema = paramsSchemaRef.current?.getSchema() ?? paramsSchema;

    try {
      setLoading(true);
      await routesService.update(routeId, {
        name: generalForm.getValues().name,
        path: generalForm.getValues().path,
        method: generalForm.getValues().method as any,
        active: generalForm.getValues().active,
        bodySchema: hasBody ? currentBodySchema : undefined,
        querySchema: currentQuerySchema,
        paramsSchema: hasParams ? currentParamsSchema : undefined,
      });
      notifications.show({
        title: "Success",
        message: "Route updated successfully",
        color: "green",
      });
      routesQueries.getById.invalidate(client, routeId);
      routesQueries.getAll.invalidate(client);
    } catch (err: any) {
      notifications.show({
        title: "Error updating route",
        message: err?.response?.data?.message || err.message || "Unknown error",
        color: "red",
      });
    } finally {
      setLoading(false);
    }
  };

  if (isLoading) {
    return (
      <Center p="xl">
        <Loader color="violet" />
      </Center>
    );
  }

  if (error || !routeData) {
    return (
      <Center p="xl">
        <Text color="red">Failed to load route data.</Text>
      </Center>
    );
  }

  return (
    <Box p="md" h="100%">
      <Group justify="space-between" mb="lg">
        <Title order={3}>Route Settings</Title>
        <Button onClick={handleUpdate} loading={loading} color="violet" leftSection={<TbDeviceFloppy />}>
          Save Changes
        </Button>
      </Group>

      <Flex h="calc(100vh - 140px)" gap="xl">
        <Paper 
          withBorder 
          w={260} 
          p="sm" 
          radius="md" 
          style={{ display: 'flex', flexDirection: 'column', backgroundColor: 'var(--mantine-color-gray-0)' }}
        >
          <Stack justify="space-between" style={{ flex: 1 }}>
            <Box>
              <Text c="dimmed" size="xs" fw={700} tt="uppercase" mb="sm" px="xs">Configuration</Text>
              
              <NavLink
                label="General Info"
                active={activeTab === "general"}
                onClick={() => setActiveTab("general")}
                color="violet"
                variant="light"
                style={{ borderRadius: 8, marginBottom: 4 }}
              />
              {hasBody && (
                <NavLink
                  label="Body Validation"
                  active={activeTab === "body"}
                  onClick={() => setActiveTab("body")}
                  color="violet"
                  variant="light"
                  style={{ borderRadius: 8, marginBottom: 4 }}
                />
              )}
              {hasParams && (
                <NavLink
                  label="Route Params"
                  active={activeTab === "params"}
                  onClick={() => setActiveTab("params")}
                  color="violet"
                  variant="light"
                  style={{ borderRadius: 8, marginBottom: 4 }}
                />
              )}
              <NavLink
                label="Query Params"
                active={activeTab === "query"}
                onClick={() => setActiveTab("query")}
                color="violet"
                variant="light"
                style={{ borderRadius: 8 }}
              />
            </Box>
            
            <Box>
              <BackToEditorButton routeId={routeId} projectId={projectId} />
            </Box>
          </Stack>
        </Paper>

        <Box style={{ flex: 1, overflowY: 'auto' }} pr="md">
          {activeTab === "general" && (
            <Stack gap="md" maw={600}>
              <Title order={4}>Route Details</Title>
              <TextInput
                label="Name"
                placeholder="e.g. Create User"
                withAsterisk
                {...generalForm.getInputProps("name")}
              />
              <TextInput
                label="Path"
                placeholder="e.g. /api/users"
                withAsterisk
                {...generalForm.getInputProps("path")}
              />
              <Select
                label="Method"
                placeholder="GET"
                data={["GET", "POST", "PUT", "DELETE"]}
                {...generalForm.getInputProps("method")}
              />
              <Switch
                label="Active"
                {...generalForm.getInputProps("active", { type: "checkbox" })}
              />
            </Stack>
          )}

          {activeTab === "body" && hasBody && (
            <Stack gap="md">
              <Title order={4}>Body Validation Schema</Title>
              <Alert icon={<TbInfoCircle />} color="violet">
                Define the payload structure expected in the HTTP request body.
              </Alert>
              <SchemaEditor
                key="bodySchema"
                ref={bodySchemaRef}
                initialData={bodySchema || { dataType: "object", properties: [] }}
                onSave={(data) => setBodySchema(data)}
              />
            </Stack>
          )}

          {activeTab === "params" && hasParams && (
            <Stack gap="md">
              <Title order={4}>Route Parameters Schema</Title>
              <Alert icon={<TbInfoCircle />} color="violet">
                The following parameters were extracted from your path:{" "}
                <Code>{pathValue}</Code>. You can configure their validation rules
                below.
              </Alert>
              <SchemaEditor
                key="paramsSchema"
                ref={paramsSchemaRef}
                initialData={paramsSchema || generatedParamsSchema || { dataType: 'object', properties: [] }}
                onSave={(data) => setParamsSchema(data)}
                locked={true}
                typeOverrides={paramTypeOverrides}
              />
            </Stack>
          )}

          {activeTab === "query" && (
            <Stack gap="md">
              <Title order={4}>Query Parameters Schema</Title>
              <Alert icon={<TbInfoCircle />} color="violet">
                Define any query string parameters this route expects (e.g.
                ?page=1&sort=desc).
              </Alert>
              <SchemaEditor
                key="querySchema"
                ref={querySchemaRef}
                initialData={querySchema}
                onSave={(data) => setQuerySchema(data)}
                allowedRootSchemaTypes={['object']}
              />
            </Stack>
          )}
        </Box>
      </Flex>
    </Box>
  );
}
