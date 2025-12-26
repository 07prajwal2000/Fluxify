import { ActionIcon, Drawer, Group, Table, Text, Tooltip } from "@mantine/core";
import React from "react";
import { FaCaretRight } from "react-icons/fa6";
import { TbRefresh } from "react-icons/tb";
import QueryLoader from "../query/queryLoader";

type Props = {
  title?: string;
  opened?: boolean;
  onClose: () => void;
  onSelect?: (key: string) => void;
  selectorKey: string;
  header: { label: string; name: string }[];
  data: Record<string, any>[];
  drawerSize?: "xs" | "sm" | "md" | "lg" | "xl";
  closeOnSelect?: boolean;
  onRefresh?: () => void;
  loading?: boolean;
  emptyNode?: React.ReactNode;
};

const KeySelector = (props: Props) => {
  function onSelectClick(data: any) {
    props.onSelect?.(data);
    if (props.closeOnSelect) {
      props.onClose();
    }
  }
  const keys = Object.keys(props.data);
  const isEmptyData = keys.length === 0 && !props.loading;

  return (
    <Drawer
      position="right"
      size={props.drawerSize}
      title={
        <Group>
          <Text size="lg" fw={"500"}>
            {props.title}
          </Text>
          {props.onRefresh && (
            <ActionIcon
              onClick={props.onRefresh}
              loading={props.loading}
              color="violet"
              variant="light"
            >
              <TbRefresh />
            </ActionIcon>
          )}
        </Group>
      }
      withCloseButton
      opened={props.opened ?? false}
      onClose={props.onClose}
    >
      <Table withRowBorders highlightOnHover striped>
        <Table.Thead>
          {!isEmptyData &&
            props.header.map((header) => (
              <Table.Th key={header.label}>{header.label}</Table.Th>
            ))}
          <Table.Th />
        </Table.Thead>
        <Table.Tbody>
          {!props.loading &&
            keys.map((key) => {
              const item = props.data[key as any];
              return (
                <Table.Tr key={key}>
                  {props.header.map((header) => (
                    <Table.Td key={header.name}>{item[header.name]}</Table.Td>
                  ))}
                  <Table.Td>
                    <Tooltip label="Choose">
                      <ActionIcon
                        onClick={() => onSelectClick(item[props.selectorKey])}
                        style={{ float: "right" }}
                        color="violet"
                        variant="outline"
                      >
                        <FaCaretRight size={15} />
                      </ActionIcon>
                    </Tooltip>
                  </Table.Td>
                </Table.Tr>
              );
            })}
        </Table.Tbody>
      </Table>
      {props.loading && <QueryLoader skeletonsCols={1} skeletonsRows={4} />}
      {isEmptyData && props.emptyNode}
    </Drawer>
  );
};

export default KeySelector;
