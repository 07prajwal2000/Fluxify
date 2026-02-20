import React from "react";
import {
  Stack,
  Group,
  Select,
  TextInput,
  ActionIcon,
  Box,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import { TbTrash, TbCheck, TbX } from "react-icons/tb";
import { Assertion } from "../types";
import JsEditButton from "@/components/editors/jsEditButton";

interface AssertionsListProps {
  assertions: Assertion[];
  onChange: (assertions: Assertion[]) => void;
  ran: boolean;
}

const AssertionsList = ({ assertions, onChange, ran }: AssertionsListProps) => {
  const updateAssertion = (id: string, updates: Partial<Assertion>) => {
    onChange(assertions.map((a) => (a.id === id ? { ...a, ...updates } : a)));
  };

  const removeAssertion = (id: string) => {
    onChange(assertions.filter((a) => a.id !== id));
  };

  const getResultTooltip = (assertion: Assertion) => {
    if (!ran) return "Run suites to view result";
    if (assertion.success) return "Success";
    return assertion.message || "Assertion failed";
  };

  return (
    <Box>
      <Box
        style={(theme) => ({
          borderRadius: theme.radius.md,
          border: `1px solid ${theme.colors.gray[2]}`,
          overflow: "hidden",
        })}
      >
        <Box
          bg="gray.0"
          py={8}
          px="md"
          style={(theme) => ({
            borderBottom: `1px solid ${theme.colors.gray[2]}`,
          })}
        >
          <Table variant="unstyled" verticalSpacing="xs">
            <thead>
              <tr style={{ textAlign: "left" }}>
                <th style={{ width: "40px" }}></th>
                <th
                  style={{
                    color: "#adb5bd",
                    fontSize: "10px",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Target
                </th>
                <th
                  style={{
                    color: "#adb5bd",
                    fontSize: "10px",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Property Path
                </th>
                <th
                  style={{
                    color: "#adb5bd",
                    fontSize: "10px",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Operator
                </th>
                <th
                  style={{
                    color: "#adb5bd",
                    fontSize: "10px",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Expected Value
                </th>
                <th style={{ width: "40px" }}></th>
              </tr>
            </thead>
          </Table>
        </Box>
        <Stack gap={0}>
          {assertions.map((assertion) => (
            <Box
              key={assertion.id}
              px="md"
              py={8}
              style={(theme) => ({
                borderBottom: `1px solid ${theme.colors.gray[1]}`,
              })}
            >
              <Group gap="md" align="center">
                <Box
                  style={{
                    width: "24px",
                    display: "flex",
                    justifyContent: "center",
                  }}
                >
                  <Tooltip
                    label={getResultTooltip(assertion)}
                    withArrow
                    position="top"
                  >
                    <Box
                      style={{
                        display: "flex",
                        alignItems: "center",
                        cursor: "help",
                      }}
                    >
                      {ran ? (
                        assertion.success === false ? (
                          <TbX size={18} color="#EF4444" />
                        ) : (
                          <TbCheck size={18} color="#10B981" />
                        )
                      ) : (
                        <Box
                          w={16}
                          h={16}
                          style={{
                            borderRadius: "100%",
                            border: "2px solid #D1D5DB",
                          }}
                        />
                      )}
                    </Box>
                  </Tooltip>
                </Box>

                <Box style={{ flex: 2 }}>
                  <Select
                    size="xs"
                    variant="default"
                    allowDeselect={false}
                    data={[
                      { value: "status", label: "Response Status" },
                      { value: "body", label: "Response Body" },
                      { value: "time", label: "Response Time (ms)" },
                      { value: "header", label: "Response Header" },
                      { value: "custom_js", label: "Custom Javascript" },
                    ]}
                    value={assertion.target}
                    onChange={(val) =>
                      updateAssertion(assertion.id, { target: val as any })
                    }
                    styles={{ input: { fontWeight: 600 } }}
                  />
                </Box>

                <Box style={{ flex: 2 }}>
                  {assertion.target === "body" ||
                  assertion.target === "header" ? (
                    <TextInput
                      size="xs"
                      variant="default"
                      placeholder={
                        assertion.target === "body" ? "data.id" : "Content-Type"
                      }
                      value={assertion.path || ""}
                      onChange={(e) =>
                        updateAssertion(assertion.id, {
                          path: e.currentTarget.value,
                        })
                      }
                      styles={{
                        input: { fontFamily: "monospace", color: "#7950F2" },
                      }}
                    />
                  ) : (
                    <Text size="xs" c="dimmed">
                      -
                    </Text>
                  )}
                </Box>

                <Box style={{ flex: 2 }}>
                  {assertion.target !== "custom_js" ? (
                    <Select
                      size="xs"
                      variant="default"
                      data={getOperators(assertion.target)}
                      value={assertion.operator}
                      onChange={(val) =>
                        updateAssertion(assertion.id, { operator: val as any })
                      }
                      styles={{ input: { fontWeight: 600 } }}
                    />
                  ) : (
                    <Text size="xs" c="dimmed">
                      -
                    </Text>
                  )}
                </Box>

                <Box style={{ flex: 3 }}>
                  {assertion.target !== "custom_js" ? (
                    assertion.operator !== "true" &&
                    assertion.operator !== "exists" ? (
                      <TextInput
                        size="xs"
                        variant="default"
                        placeholder="Expected"
                        value={assertion.expected}
                        onChange={(e) =>
                          updateAssertion(assertion.id, {
                            expected: e.currentTarget.value,
                          })
                        }
                        styles={{ input: { fontFamily: "monospace" } }}
                      />
                    ) : (
                      <Text size="xs" c="dimmed">
                        N/A
                      </Text>
                    )
                  ) : (
                    <JsEditButton
                      value={assertion.customJs || ""}
                      onChange={(val) =>
                        updateAssertion(assertion.id, { customJs: val })
                      }
                      label="Edit JS"
                    />
                  )}
                </Box>

                <Box style={{ width: "24px" }}>
                  <ActionIcon
                    variant="subtle"
                    color="gray.4"
                    onClick={() => removeAssertion(assertion.id)}
                  >
                    <TbTrash size={16} />
                  </ActionIcon>
                </Box>
              </Group>
            </Box>
          ))}
        </Stack>
      </Box>

      {assertions.length > 0 && (
        <Box mt="xs" px={4}>
          <Text size="10px" c="dimmed" fw={500} fs="italic">
            Rules Preview:{" "}
            {assertions
              .map((a) => {
                if (a.target === "custom_js") return "Custom JS Check";
                const target =
                  a.target === "status"
                    ? "Status"
                    : a.target === "body"
                      ? `Body(${a.path})`
                      : a.target === "time"
                        ? "Time"
                        : `Header(${a.path})`;
                return `${target} ${a.operator.replace("_", " ")} ${a.expected}`;
              })
              .join(" | ")}
          </Text>
        </Box>
      )}

      {ran && assertions.some((a) => a.success === false) && (
        <Stack gap="xs" mt="md" px={4}>
          <Text size="sm" fw={700} c="red.7">
            Failed Assertions
          </Text>
          {assertions
            .filter((a) => a.success === false)
            .map((a, i) => (
              <Box
                key={`failed-${i}`}
                bg="red.0"
                p="xs"
                style={{
                  borderRadius: "6px",
                  border: "1px solid #FECACA",
                }}
              >
                <Text size="xs" c="red.8" fw={500}>
                  {a.message || "Assertion evaluation failed"}
                </Text>
              </Box>
            ))}
        </Stack>
      )}
    </Box>
  );
};

const getOperators = (target: string) => {
  const common = [
    { value: "eq", label: "Equals" },
    { value: "neq", label: "Not Equals" },
  ];
  if (target === "status" || target === "time") {
    return [
      ...common,
      { value: "lt", label: "Less Than" },
      { value: "gt", label: "Greater Than" },
    ];
  }
  if (target === "body" || target === "header") {
    return [
      ...common,
      { value: "contains", label: "Contains" },
      { value: "true", label: "Is True" },
      { value: "false", label: "Is False" },
      { value: "exists", label: "Exists" },
      { value: "not_exists", label: "Not Exists" },
    ];
  }
  return common;
};

export default AssertionsList;
