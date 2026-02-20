import { Badge, Box, Tabs } from "@mantine/core";
import React from "react";
import KVPEditor from "@/components/editors/kvpEditor";
import Editor from "@monaco-editor/react";
import PathVariablesEditor from "./PathVariablesEditor";

interface RequestConfigProps {
  method: string;
  pathParams: Record<string, string>;
  onPathParamsChange: (data: Record<string, string>) => void;
  queryParams: Record<string, string>;
  onQueryParamsChange: (data: Record<string, string>) => void;
  headers: Record<string, string>;
  onHeadersChange: (data: Record<string, string>) => void;
  body: string;
  onBodyChange: (data: string) => void;
}

const RequestConfig = ({
  method,
  pathParams,
  onPathParamsChange,
  queryParams,
  onQueryParamsChange,
  headers,
  onHeadersChange,
  body,
  onBodyChange,
}: RequestConfigProps) => {
  const isBodyDisabled = ["GET", "DELETE"].includes(method.toUpperCase());

  return (
    <Box bg="white" style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <Tabs defaultValue="params" color="violet">
        <Tabs.List px="md" style={{ borderBottom: "1px solid #eee" }}>
          <Tabs.Tab value="params" py="sm">Params</Tabs.Tab>
          <Tabs.Tab value="headers" py="sm">Headers</Tabs.Tab>
          {!isBodyDisabled && <Tabs.Tab value="body" py="sm">Body</Tabs.Tab>}
        </Tabs.List>

        <Box p="md" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <Tabs.Panel value="params">
            <Box mb="xl">
              <PathVariablesEditor
                pathParams={pathParams}
                onPathParamsChange={onPathParamsChange}
              />
            </Box>
            <Box>
              <KVPEditor
                data={queryParams}
                onDataChange={onQueryParamsChange}
                addButtonText="Add Query Parameter"
                inputType="text"
              />
            </Box>
          </Tabs.Panel>

          <Tabs.Panel value="headers">
            <KVPEditor
              data={headers}
              onDataChange={onHeadersChange}
              addButtonText="Add Header"
              inputType="text"
            />
          </Tabs.Panel>

          {!isBodyDisabled && (
            <Tabs.Panel value="body">
              <Box style={{ display: "flex", flexDirection: "column", height: "300px" }}>
                <Box mb="xs">
                  <Badge variant="light" color="gray" radius="sm">JSON</Badge>
                </Box>
                <Box style={{ flex: 1, border: '1px solid #eee', borderRadius: '8px', overflow: 'hidden' }}>
                  <Editor
                    height="100%"
                    defaultLanguage="json"
                    theme="vs-light"
                    value={body}
                    onChange={(v) => onBodyChange(v || "")}
                    options={{
                      minimap: { enabled: false },
                      fontSize: 13,
                      scrollBeyondLastLine: false,
                      padding: { top: 10, bottom: 10 },
                    }}
                  />
                </Box>
              </Box>
            </Tabs.Panel>
          )}
        </Box>
      </Tabs>
    </Box>
  );
};

export default RequestConfig;
