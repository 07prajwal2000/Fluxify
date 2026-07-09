import React from "react";
import {
  Checkbox,
  Box,
  Center,
  Loader,
  Stack,
  Text,
  Group,
  Tooltip,
  Badge,
} from "@mantine/core";
import { TbCaretUp, TbCaretDown, TbLock, TbLockOpen, TbAbc, TbCode, TbHash } from "react-icons/tb";
import { useAppConfig } from "@/context/appConfigPage";
import { appConfigService } from "@/services/appConfig";
import z from "zod";
import { getTimeAgo } from "@/lib/datetime";
import AppConfigTableEditButton from "../buttons/appConfigTableEditButton";

const schema = appConfigService.getAllResponseSchema.shape.data;

interface AppConfigTableProps {
  data: z.infer<typeof schema>;
  isLoading: boolean;
  onDelete: (ids: string[]) => void;
  isDeleting?: boolean;
}

const SORTABLE_COLUMNS = [
  "keyName",
  "isEncrypted",
  "encodingType",
  "updatedAt",
  "createdAt",
];

const GRID_TEMPLATE = "50px minmax(200px, 2fr) 120px 140px 150px 150px 60px";

const AppConfigTable: React.FC<AppConfigTableProps> = ({
  data,
  isLoading,
}) => {
  const {
    selectedItems,
    selectItem,
    deselectItem,
    sortBy,
    sort,
    search,
    setSort,
    setSortBy,
  } = useAppConfig();

  const handleSelectAll = () => {
    if (selectedItems.size === data.length) {
      selectedItems.forEach((id) => deselectItem(id));
    } else {
      data.forEach((item) => selectItem(item.id.toString()));
    }
  };

  const handleSelectItem = (id: string) => {
    if (selectedItems.has(id)) {
      deselectItem(id);
    } else {
      selectItem(id);
    }
  };

  const handleSort = (column: string) => {
    if (sortBy === column) {
      setSort(sort === "asc" ? "desc" : "asc");
    } else {
      setSortBy(column);
      setSort("asc");
    }
  };

  const getSortIcon = (column: string) => {
    if (sortBy !== column) return null;
    return sort === "asc" ? <TbCaretUp size={16} color="#7432df" /> : <TbCaretDown size={16} color="#7432df" />;
  };

  const HeaderCell = ({ label, columnKey }: { label: string; columnKey: string }) => {
    const isSortable = SORTABLE_COLUMNS.includes(columnKey);
    return (
      <Group
        gap={4}
        wrap="nowrap"
        onClick={() => isSortable && handleSort(columnKey)}
        style={{ cursor: isSortable ? "pointer" : "default", userSelect: "none" }}
      >
        <Text size="xs" fw={600} c="#8d9195" style={{ textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "Inter, sans-serif" }}>
          {label}
        </Text>
        {isSortable && getSortIcon(columnKey)}
      </Group>
    );
  };

  if (isLoading) {
    return (
      <Center h="100%" py={40}>
        <Stack align="center" gap="md">
          <Loader size="lg" color="#7432df" />
          <Text c="dimmed" style={{ fontFamily: "Inter, sans-serif" }}>Loading configurations...</Text>
        </Stack>
      </Center>
    );
  }

  return (
    <Box style={{ display: "flex", flexDirection: "column", height: "100%", backgroundColor: "#fff" }}>
      {/* Header */}
      <Box
        style={{
          display: "grid",
          gridTemplateColumns: GRID_TEMPLATE,
          alignItems: "center",
          padding: "16px 20px",
          borderBottom: "1px solid rgba(0, 0, 0, 0.05)",
          backgroundColor: "#F8F9FA",
          position: "sticky",
          top: 0,
          zIndex: 10,
        }}
      >
        <Checkbox
          color="#7432df"
          checked={data.length > 0 && selectedItems.size === data.length}
          indeterminate={selectedItems.size > 0 && selectedItems.size < data.length}
          onChange={handleSelectAll}
        />
        <HeaderCell label="Key Name" columnKey="keyName" />
        <HeaderCell label="Encrypted" columnKey="isEncrypted" />
        <HeaderCell label="Encoding Type" columnKey="encodingType" />
        <HeaderCell label="Updated At" columnKey="updatedAt" />
        <HeaderCell label="Created At" columnKey="createdAt" />
        <Box /> {/* Empty cell for actions */}
      </Box>

      {/* Body */}
      <Box style={{ flex: 1, overflowY: "auto" }}>
        {data.map((item) => {
          const isSelected = selectedItems.has(item.id.toString());
          return (
            <Box
              key={item.id}
              onClick={() => handleSelectItem(item.id.toString())}
              style={{
                display: "grid",
                gridTemplateColumns: GRID_TEMPLATE,
                alignItems: "center",
                padding: "16px 20px",
                borderBottom: "1px solid rgba(0, 0, 0, 0.03)",
                backgroundColor: isSelected ? "rgba(116, 50, 223, 0.05)" : "transparent",
                transition: "background-color 0.2s ease",
                cursor: "pointer",
                fontFamily: "Inter, sans-serif",
              }}
            >
              <Box onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  color="#7432df"
                  checked={isSelected}
                  onChange={() => handleSelectItem(item.id.toString())}
                />
              </Box>
              <Text fw={500} c="#111417" size="sm" truncate>
                {item.keyName}
              </Text>
              <Box>
                {item.isEncrypted ? (
                  <Badge color="green" variant="light" leftSection={<TbLock size={12} />} size="sm">
                    Yes
                  </Badge>
                ) : (
                  <Badge color="gray" variant="light" leftSection={<TbLockOpen size={12} />} size="sm">
                    No
                  </Badge>
                )}
              </Box>
              <Box>
                {item.encodingType === "plaintext" && (
                  <Badge color="blue" variant="light" leftSection={<TbAbc size={14} style={{ marginTop: 2 }} />} size="sm" style={{ textTransform: "capitalize" }}>
                    Plaintext
                  </Badge>
                )}
                {item.encodingType === "base64" && (
                  <Badge color="violet" variant="light" leftSection={<TbCode size={14} style={{ marginTop: 2 }} />} size="sm" style={{ textTransform: "capitalize" }}>
                    Base64
                  </Badge>
                )}
                {item.encodingType === "hex" && (
                  <Badge color="orange" variant="light" leftSection={<TbHash size={14} style={{ marginTop: 2 }} />} size="sm" style={{ textTransform: "uppercase" }}>
                    Hex
                  </Badge>
                )}
                {!item.encodingType && (
                  <Text size="sm" c="#464749">-</Text>
                )}
              </Box>
              <Tooltip label={new Date(item.updatedAt).toLocaleString()}>
                <Text size="sm" c="#8d9195">
                  {getTimeAgo(item.updatedAt)}
                </Text>
              </Tooltip>
              <Tooltip label={new Date(item.createdAt).toLocaleString()}>
                <Text size="sm" c="#8d9195">
                  {getTimeAgo(item.createdAt)}
                </Text>
              </Tooltip>
              <Box onClick={(e) => e.stopPropagation()}>
                <AppConfigTableEditButton id={item.id.toString()} />
              </Box>
            </Box>
          );
        })}

        {data.length === 0 && (
          <Center py={60}>
            <Text ta="center" c="dimmed" style={{ fontFamily: "Inter, sans-serif" }}>
              No configurations found for "{search}"
            </Text>
          </Center>
        )}
      </Box>
    </Box>
  );
};

export default AppConfigTable;
