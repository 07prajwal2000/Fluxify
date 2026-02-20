import React, { useState } from "react";
import {
  Box,
  Group,
  Text,
  ActionIcon,
  Tabs,
  Table,
  ScrollArea,
} from "@mantine/core";
import { TbClock, TbServer, TbCopy } from "react-icons/tb";
import Editor from "@monaco-editor/react";

interface ResponseSectionProps {
  status: number;
  statusText: string;
  time: number;
  size: string;
  data: any;
  headers?: Record<string, string>;
}

const ResponseSection = ({
  status,
  statusText,
  time,
  size,
  data,
  headers,
}: ResponseSectionProps) => {
  const [activeTab, setActiveTab] = useState<string | null>("body");
  const isSuccess = status >= 200 && status < 300;

  const copyToClipboard = () => {
    const content =
      activeTab === "body"
        ? JSON.stringify(data, null, 2)
        : JSON.stringify(headers, null, 2);
    navigator.clipboard.writeText(content);
  };

  return (
    <Box
      bg="white"
      style={{ display: "flex", flexDirection: "column", height: "100%" }}
    >
      {/* Response Stats Bar */}
      <Box
        px="md"
        py="xs"
        bg="#F9FAFB"
        style={{ borderBottom: "1px solid #E5E7EB" }}
      >
        <Group justify="space-between">
          <Group gap="xl">
            <Group gap={6}>
              <Text size="xs" c="gray.5" fw={600}>
                Status:
              </Text>
              <Text size="xs" fw={700} c={isSuccess ? "green.6" : "red.6"}>
                {status} {statusText}
              </Text>
            </Group>
            <Group gap={6}>
              <TbClock size={14} color="#9CA3AF" />
              <Text size="xs" fw={600} c="gray.6">
                {time} ms
              </Text>
            </Group>
            <Group gap={6}>
              <TbServer size={14} color="#9CA3AF" />
              <Text size="xs" fw={600} c="gray.6">
                {size}
              </Text>
            </Group>
          </Group>
          <Group gap="xs">
            <Tabs
              value={activeTab}
              onChange={setActiveTab}
              color="violet"
              variant="default"
              radius="sm"
            >
              <Tabs.List>
                <Tabs.Tab value="body" px="sm" py={4} fz="xs">
                  Body
                </Tabs.Tab>
                <Tabs.Tab value="headers" px="sm" py={4} fz="xs">
                  Headers
                </Tabs.Tab>
              </Tabs.List>
            </Tabs>
          </Group>
        </Group>
      </Box>

      {/* Content Viewer */}
      <Box
        style={{
          flex: 1,
          position: "relative",
          backgroundColor: activeTab === "body" ? "#1E1E1E" : "#FFF",
          overflow: "hidden",
        }}
      >
        {activeTab === "body" ? (
          <>
            <Box pos="absolute" top={10} right={10} style={{ zIndex: 10 }}>
              <ActionIcon
                variant="filled"
                color="gray.8"
                size="sm"
                onClick={copyToClipboard}
                title="Copy to clipboard"
              >
                <TbCopy size={14} />
              </ActionIcon>
            </Box>
            <Editor
              height="100%"
              defaultLanguage="json"
              theme="vs-dark"
              value={JSON.stringify(data, null, 2)}
              options={{
                readOnly: true,
                minimap: { enabled: false },
                fontSize: 12,
                padding: { top: 16, bottom: 16 },
                lineNumbers: "on",
                scrollBeyondLastLine: false,
                wordWrap: "on",
              }}
            />
          </>
        ) : (
          <ScrollArea style={{ height: "100%" }}>
            <Table striped highlightOnHover withRowBorders>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th>Value</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {Object.entries(headers || {}).map(([key, value]) => (
                  <Table.Tr key={key}>
                    <Table.Td fw={600} fz="sm" c="gray.7">
                      {key}
                    </Table.Td>
                    <Table.Td fz="sm" style={{ wordBreak: "break-all" }}>
                      {value as string}
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </ScrollArea>
        )}
      </Box>
    </Box>
  );
};

export default ResponseSection;
