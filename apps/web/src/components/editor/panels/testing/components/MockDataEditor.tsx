import React from "react";
import { Box, Group, Paper, Text, Badge } from "@mantine/core";
import { TbServer } from "react-icons/tb";
import Editor from "@monaco-editor/react";

interface MockDataEditorProps {
  mockData: string;
  onChange: (value: string) => void;
}

export default function MockDataEditor({
  mockData,
  onChange,
}: MockDataEditorProps) {
  return (
    <Box>
      <Group gap="sm" mb="sm">
        <TbServer size={18} color="#7950F2" />
        <Text size="sm" fw={700} c="gray.8">
          Mock Data Injection
        </Text>
      </Group>
      <Paper withBorder radius="md" bg="#F9FAFB" p="md">
        <Text size="xs" c="gray.5" mb="md">
          Provide mock data context that can be used during this test execution.
        </Text>
        <Paper
          withBorder
          radius="md"
          style={{ overflow: "hidden", position: "relative" }}
        >
          <Box pos="absolute" top={10} right={10} style={{ zIndex: 5 }}>
            <Badge variant="light" color="gray" size="sm" radius="sm">
              JSON
            </Badge>
          </Box>
          <Editor
            height="150px"
            defaultLanguage="json"
            theme="vs-light"
            value={mockData}
            onChange={(v) => onChange(v || "")}
            options={{
              minimap: { enabled: false },
              fontSize: 13,
              scrollBeyondLastLine: false,
              padding: { top: 10, bottom: 10 },
            }}
          />
        </Paper>
      </Paper>
    </Box>
  );
}
