import React from "react";
import {
  Table,
  Select,
  TextInput,
  ActionIcon,
  Button,
  Text,
  Box,
  Paper,
  rem,
} from "@mantine/core";
import { TbPlus, TbTrashFilled } from "react-icons/tb";

export type AssertionTarget = "status" | "body" | "time";
export type AssertionOperator = "equals" | "contains" | "true";

export interface Assertion {
  id: string;
  target: AssertionTarget;
  path?: string;
  operator: AssertionOperator;
  expected: string;
}

interface AssertionsBuilderProps {
  assertions: Assertion[];
  onChange: (assertions: Assertion[]) => void;
}

const AssertionsBuilder = ({ assertions, onChange }: AssertionsBuilderProps) => {
  const addRule = () => {
    onChange([
      ...assertions,
      { id: Math.random().toString(), target: "status", operator: "equals", expected: "" },
    ]);
  };

  const updateRule = (id: string, updates: Partial<Assertion>) => {
    onChange(assertions.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  };

  const removeRule = (id: string) => {
    onChange(assertions.filter((a) => a.id !== id));
  };

  return (
    <Paper withBorder radius="md" bg="white" shadow="sm">
      <Box p="md" style={{ borderBottom: '1px solid #f1f3f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text fw={800} size="xs" c="gray.6" style={{ textTransform: 'uppercase', letterSpacing: '0.8px' }}>
          Assertions Builder
        </Text>
        <Button 
          variant="light" 
          color="violet" 
          size="compact-xs" 
          leftSection={<TbPlus size={14} />} 
          onClick={addRule}
          fw={700}
        >
          Add Rule
        </Button>
      </Box>

      <Box>
        <Table verticalSpacing={10} horizontalSpacing="md">
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #f1f3f5' }}>
              <th style={{ color: '#adb5bd', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800, padding: '12px 16px' }}>Target</th>
              <th style={{ color: '#adb5bd', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800, padding: '12px 16px' }}>Property Path</th>
              <th style={{ color: '#adb5bd', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800, padding: '12px 16px' }}>Operator</th>
              <th style={{ color: '#adb5bd', fontSize: '10px', textTransform: 'uppercase', fontWeight: 800, padding: '12px 16px' }}>Expected Value</th>
              <th style={{ width: 50 }}></th>
            </tr>
          </thead>
          <tbody>
            {assertions.map((rule) => (
              <tr key={rule.id} style={{ borderBottom: '1px solid #f8f9fa' }}>
                <td style={{ padding: '8px 16px' }}>
                  <Select
                    size="xs"
                    radius="sm"
                    data={[
                      { value: "status", label: "Status Code" },
                      { value: "body", label: "Response Body" },
                      { value: "time", label: "Response Time" },
                    ]}
                    value={rule.target}
                    onChange={(v) => updateRule(rule.id, { target: v as AssertionTarget })}
                    styles={{ input: { border: '1px solid #e9ecef', fontWeight: 600, height: rem(32) } }}
                  />
                </td>
                <td style={{ padding: '8px 16px' }}>
                  <TextInput
                    size="xs"
                    radius="sm"
                    placeholder="e.g. data.id"
                    disabled={rule.target === "status"}
                    value={rule.path || ""}
                    onChange={(e) => updateRule(rule.id, { path: e.currentTarget.value })}
                    styles={{ input: { border: '1px solid #e9ecef', height: rem(32) } }}
                  />
                </td>
                <td style={{ padding: '8px 16px' }}>
                  <Select
                    size="xs"
                    radius="sm"
                    data={[
                      { value: "equals", label: "Equals" },
                      { value: "contains", label: "Contains" },
                      { value: "true", label: "Is True" },
                    ]}
                    value={rule.operator}
                    onChange={(v) => updateRule(rule.id, { operator: v as AssertionOperator })}
                    styles={{ input: { border: '1px solid #e9ecef', fontWeight: 600, height: rem(32) } }}
                  />
                </td>
                <td style={{ padding: '8px 16px' }}>
                  <TextInput
                    size="xs"
                    radius="sm"
                    placeholder="Value"
                    disabled={rule.operator === "true"}
                    value={rule.expected}
                    onChange={(e) => updateRule(rule.id, { expected: e.currentTarget.value })}
                    styles={{ input: { border: '1px solid #e9ecef', height: rem(32) } }}
                  />
                </td>
                <td style={{ padding: '8px 16px' }}>
                  <ActionIcon variant="subtle" color="red.4" onClick={() => removeRule(rule.id)}>
                    <TbTrashFilled size={16} />
                  </ActionIcon>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
        
        {assertions.length === 0 && (
          <Box py={40} ta="center">
            <Text size="sm" c="dimmed" fs="italic">No assertions defined. Add one to validate the response.</Text>
          </Box>
        )}
      </Box>
    </Paper>
  );
};

export default AssertionsBuilder;
