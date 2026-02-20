import React from "react";
import { Tabs, Stack, TextInput, Text, Paper, Box } from "@mantine/core";
import Editor from "@monaco-editor/react";
import KVPEditor from "@/components/editors/kvpEditor";

interface RequestEditorProps {
  method: string;
  pathParams: Record<string, string>;
  onPathParamsChange: (params: Record<string, string>) => void;
  queryParams: Record<string, string>;
  onQueryParamsChange: (params: Record<string, string>) => void;
  headers: Record<string, string>;
  onHeadersChange: (headers: Record<string, string>) => void;
  body: string;
  onBodyChange: (body: string) => void;
}

/**
 * Shared Request Editor component.
 * Modularizes the configuration of path variables, query strings, headers, and payload.
 */
const RequestEditor = ({
  method,
  pathParams,
  onPathParamsChange,
  queryParams,
  onQueryParamsChange,
  headers,
  onHeadersChange,
  body,
  onBodyChange,
}: RequestEditorProps) => {
  const isBodyDisabled = ["GET", "DELETE"].includes(method.toUpperCase());

  return (
    <Tabs defaultValue="params" color="violet" variant="outline" styles={{
      tab: { fontWeight: 600, fontSize: '13px' },
      panel: { paddingTop: '16px' }
    }}>
      <Tabs.List>
        <Tabs.Tab value="params">Path Variables</Tabs.Tab>
        <Tabs.Tab value="query">Query Params</Tabs.Tab>
        <Tabs.Tab value="headers">Headers</Tabs.Tab>
        {!isBodyDisabled && <Tabs.Tab value="body">Body</Tabs.Tab>}
      </Tabs.List>

      <Tabs.Panel value="params">
        {Object.keys(pathParams).length > 0 ? (
          <Stack gap="xs">
            {Object.entries(pathParams).map(([key, value]) => (
              <TextInput
                key={key}
                label={key}
                placeholder={`Value for :${key}`}
                value={value}
                onChange={(e) => onPathParamsChange({ ...pathParams, [key]: e.currentTarget.value })}
                styles={{ label: { fontWeight: 700, fontSize: '12px', color: 'gray' } }}
              />
            ))}
          </Stack>
        ) : (
          <Box p="md" bg="gray.0" style={{ borderRadius: '8px', border: '1px dashed #ced4da' }}>
            <Text size="sm" c="dimmed" ta="center">No path parameters detected in route.</Text>
          </Box>
        )}
      </Tabs.Panel>

      <Tabs.Panel value="query">
        <KVPEditor 
          data={queryParams} 
          onDataChange={onQueryParamsChange} 
          inputType="text"
          addButtonText="Add Query Parameter" 
        />
      </Tabs.Panel>

      <Tabs.Panel value="headers">
        <KVPEditor 
          data={headers} 
          onDataChange={onHeadersChange} 
          inputType="text"
          addButtonText="Add Header" 
        />
      </Tabs.Panel>

      <Tabs.Panel value="body">
        <Paper withBorder radius="md" style={{ overflow: "hidden" }}>
          <Editor
            height="200px"
            defaultLanguage="json"
            theme="vs-light"
            value={body}
            onChange={(v) => onBodyChange(v || "")}
            options={{ 
              minimap: { enabled: false }, 
              fontSize: 13, 
              scrollBeyondLastLine: false,
              lineNumbers: "on",
              folding: true,
              padding: { top: 10, bottom: 10 }
            }}
          />
        </Paper>
      </Tabs.Panel>
    </Tabs>
  );
};

export default RequestEditor;
