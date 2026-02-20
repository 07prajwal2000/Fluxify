import React from "react";
import {
  Box,
  Group,
  Text,
  Badge,
  Button,
  ActionIcon,
  Menu,
} from "@mantine/core";
import {
  TbCheck,
  TbX,
  TbPlayerPlayFilled,
  TbDeviceFloppy,
  TbDotsVertical,
  TbEdit,
  TbTrash,
} from "react-icons/tb";

interface TestSuiteHeaderProps {
  suiteName?: string;
  suiteDescription?: string;
  status: "passed" | "failed" | null;
  running: boolean;
  isSaving: boolean;
  onRun: () => void;
  onSave: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export default function TestSuiteHeader({
  suiteName,
  suiteDescription,
  status,
  running,
  isSaving,
  onRun,
  onSave,
  onEdit,
  onDelete,
}: TestSuiteHeaderProps) {
  return (
    <Box
      px="xl"
      py="lg"
      style={{
        borderBottom: "1px solid #eee",
        backgroundColor: "white",
        zIndex: 5,
        flexShrink: 0,
      }}
    >
      <Group justify="space-between">
        <Box>
          <Group gap="sm">
            <Text size="xl" fw={800} c="gray.8">
              {suiteName || "Loading..."}
            </Text>
            {status === "passed" && (
              <Badge
                variant="light"
                color="green"
                radius="sm"
                leftSection={<TbCheck size={12} />}
              >
                Passed
              </Badge>
            )}
            {status === "failed" && (
              <Badge
                variant="light"
                color="red"
                radius="sm"
                leftSection={<TbX size={12} />}
              >
                Failed
              </Badge>
            )}
          </Group>
          <Text size="sm" c="gray.5" mt={2}>
            {suiteDescription}
          </Text>
        </Box>
        <Group gap="xs">
          <Button
            color="green.8"
            size="md"
            px="xl"
            leftSection={<TbPlayerPlayFilled size={16} />}
            onClick={onRun}
            loading={running}
            style={{ fontWeight: 700 }}
          >
            Run Suite
          </Button>
          <ActionIcon
            color="violet"
            size="md"
            mr="sm"
            onClick={onSave}
            loading={isSaving}
            variant="subtle"
          >
            <TbDeviceFloppy size={20} />
          </ActionIcon>
          <Menu shadow="md" width={200} position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" size="lg" color="dark">
                <TbDotsVertical />
              </ActionIcon>
            </Menu.Target>

            <Menu.Dropdown>
              <Menu.Item leftSection={<TbEdit size={14} />} onClick={onEdit}>
                Edit Suite Info
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<TbTrash size={14} />}
                onClick={onDelete}
              >
                Delete Suite
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
    </Box>
  );
}
