"use client";
import { appConfigQuery } from "@/query/appConfigQuery";
import {
  ActionIcon,
  Box,
  Group,
  Paper,
  Popover,
  Select,
  Text,
  TextInput,
  Tooltip,
} from "@mantine/core";
import React, { useState } from "react";
import { TbReload, TbSquareKey, TbX } from "react-icons/tb";
import QueryError from "../query/queryError";
import { useQueryClient } from "@tanstack/react-query";
import KeySelector from "./keySelector";
import { useDisclosure } from "@mantine/hooks";

type PropTypes = {
  value: string;
  label?: string;
  description?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
};

const AppConfigSelector = (props: PropTypes) => {
  const [value, setValue] = useState("");
  const [showModal, { open, close }] = useDisclosure(false);
  const { data, isLoading, isRefetching, isError } =
    appConfigQuery.getKeysList.useQuery("");
  const client = useQueryClient();

  React.useEffect(() => {
    setValue(props.value);
  }, [props.value]);

  function refetch() {
    appConfigQuery.getKeysList.invalidate("", client);
  }

  function onSelectChange(val: string) {
    const value = "cfg:" + val;
    onValueChange(value);
  }
  function onValueChange(val: string) {
    setValue(val);
    props.onChange?.(val);
  }
  const isConfig = value.startsWith("cfg:");

  function clearValue() {
    onValueChange("");
  }

  return (
    <Paper w={"100%"}>
      {props.label && <Text>{props.label}</Text>}
      {props.description && (
        <Text size="xs" style={{ textWrap: "wrap" }} c={"gray"}>
          {props.description}
        </Text>
      )}
      <Group pr={"xs"} bd={"1px solid gray.4"} bdrs={"sm"}>
        {isConfig ? (
          <Group flex={1} c="white" bg={"violet.6"} p={2}>
            <Box px={"xs"} py={"3"} m={1} flex={1}>
              {value.slice(4)}
            </Box>
            <Tooltip label="Clear Value" withArrow arrowSize={8} color="dark">
              <ActionIcon onClick={clearValue} variant="subtle" color="white">
                <TbX />
              </ActionIcon>
            </Tooltip>
          </Group>
        ) : (
          <TextInput
            placeholder={props.placeholder}
            px={"xs"}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            variant="unstyled"
            flex={1}
          />
        )}
        <ActionIcon
          onClick={open}
          variant={isConfig ? "light" : "transparent"}
          color="violet"
        >
          <TbSquareKey size={20} />
        </ActionIcon>
        <KeySelector
          loading={isLoading || isRefetching}
          onRefresh={refetch}
          opened={showModal}
          onClose={close}
          data={data?.map((key) => ({ key })) ?? ({} as any)}
          header={[{ label: "Key", name: "key" }]}
          selectorKey="key"
          closeOnSelect
          drawerSize="sm"
          onSelect={onSelectChange}
          title="Choose App Config"
          emptyNode={
            isError ? (
              <Text c={"red.8"} ta={"center"}>
                Error occured while loading app configs. Please refresh and try
                again
              </Text>
            ) : (
              <Text c={"red.8"} ta={"center"}>
                Nothing found
              </Text>
            )
          }
        />
      </Group>
    </Paper>
  );
};

export default AppConfigSelector;
