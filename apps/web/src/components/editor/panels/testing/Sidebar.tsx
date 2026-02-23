import React from "react";
import {
  Box,
  Text,
  UnstyledButton,
  ActionIcon,
  Stack,
  rem,
  Group,
  Divider,
} from "@mantine/core";
import {
  TbTerminal2,
  TbFlask,
  TbPlus,
  TbPlayerPlayFilled,
} from "react-icons/tb";
import { TestSuite } from "./types";
import MenuItem from "@/components/rootSidebar/menuItem";

interface SidebarProps {
  activeId: string;
  onSelect: (id: string) => void;
  suites: TestSuite[];
  onAddClick: () => void;
  onRunAllClick?: () => void;
  isRunAllLoading?: boolean;
}

const Sidebar = ({
  activeId,
  onSelect,
  suites,
  onAddClick,
  onRunAllClick,
  isRunAllLoading,
}: SidebarProps) => {
  return (
    <Box
      w={280}
      bg="white"
      style={{ borderRight: "1px solid #eee", flexShrink: 0 }}
      p="md"
    >
      <Stack gap="xl">
        <Box>
          <Text
            size="xs"
            fw={900}
            c="dark"
            mb="sm"
            style={{ textTransform: "uppercase", letterSpacing: rem(1.5) }}
          >
            Manual Testing
          </Text>
          <NavItem
            icon={<TbTerminal2 size={20} />}
            label="API Playground"
            active={activeId === "playground"}
            onClick={() => onSelect("playground")}
          />
        </Box>

        <Divider color="gray.2" />

        <Box>
          <Group justify="space-between" mb="sm" px={4}>
            <Text
              size="xs"
              fw={900}
              c="dark"
              style={{ textTransform: "uppercase", letterSpacing: rem(1.5) }}
            >
              Test Suites
            </Text>
            <Group gap="xs">
              {suites.length > 0 && onRunAllClick && (
                <ActionIcon
                  variant="light"
                  size="sm"
                  color="green.8"
                  loading={isRunAllLoading}
                  onClick={onRunAllClick}
                  radius="sm"
                  title="Run All Suites"
                >
                  <TbPlayerPlayFilled size={14} />
                </ActionIcon>
              )}
              <ActionIcon
                variant="filled"
                size="sm"
                color="violet.6"
                onClick={onAddClick}
                radius="sm"
              >
                <TbPlus size={16} />
              </ActionIcon>
            </Group>
          </Group>
          <Stack gap={4}>
            {suites.map((suite) => (
              <NavItem
                key={suite.id}
                icon={<TbFlask size={20} />}
                label={suite.name}
                description={suite.description}
                active={activeId === suite.id}
                onClick={() => onSelect(suite.id)}
              />
            ))}
            {suites.length === 0 && (
              <Text size="xs" c="dimmed" ta="center" py="md">
                No test suites yet.
              </Text>
            )}
          </Stack>
        </Box>
      </Stack>
    </Box>
  );
};

const NavItem = ({
  icon,
  label,
  description,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  active: boolean;
  onClick: () => void;
}) => (
  <MenuItem
    onClick={onClick}
    isActive={active}
    leftIcon={icon}
    color="dark"
    text={
      <Box style={{ flex: 1 }}>
        <Text size="sm" fw={active ? 700 : 600}>
          {label}
        </Text>
        {description && (
          <Text size="10px" c="dimmed" lineClamp={1} fw={400}>
            {description}
          </Text>
        )}
      </Box>
    }
  />
);

export default Sidebar;
