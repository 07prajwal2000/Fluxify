import { useRouterFilter } from "@/store/routes";
import {
  ActionIcon,
  Button,
  Checkbox,
  Indicator,
  Menu,
  NativeSelect,
  Select,
  Stack,
} from "@mantine/core";
import React from "react";
import { TbFilterCog } from "react-icons/tb";
import DebouncedTextInput from "../editors/debouncedTextInput";

const RouterFilter = () => {
  const { field, operator, value, reset, setField, setValue, setOperator } =
    useRouterFilter();
  function onFieldChange(value: string | null) {
    if (!value) return;
    setField(value);
  }
  function onValueChange(value: string) {
    setValue(value ?? "");
  }
  function onOperatorChange(value: string | null) {
    if (!value) return;
    setOperator(value);
  }
  return (
    <Menu shadow="lg" width={200} withArrow position="bottom-end">
      <Menu.Target>
        <Indicator color="red" disabled={!!!value}>
          <ActionIcon color={"violet"} variant="outline">
            <TbFilterCog size={20} />
          </ActionIcon>
        </Indicator>
      </Menu.Target>
      <Menu.Dropdown p={"xs"}>
        <Stack gap={"sm"} mb={"sm"}>
          <NativeSelect
            description="Select field to apply filter on"
            value={field}
            onChange={(e) => onFieldChange(e.target.value)}
            data={[
              { label: "Name", value: "name" },
              { label: "Path", value: "path" },
              { label: "Active", value: "active" },
              { label: "HTTP Method", value: "method" },
              { label: "Id", value: "id" },
            ]}
          />
          <NativeSelect
            description="Select operator to apply filter on"
            value={operator}
            onChange={(e) => onOperatorChange(e.currentTarget.value)}
            data={[
              { label: "=", value: "eq" },
              { label: "!=", value: "neq" },
              { label: ">", value: "gt" },
              { label: ">=", value: "gte" },
              { label: "<", value: "lt" },
              { label: "<=", value: "lte" },
              { label: "contains", value: "like" },
            ]}
          />
          {field === "active" ? (
            <Checkbox
              onChange={(e) => setValue(e.currentTarget.checked.toString())}
              description="Check to get the active routes"
              checked={value === "true"}
              color={"violet"}
            />
          ) : (
            <DebouncedTextInput
              onValueChange={onValueChange}
              value={value}
              debounceDelay={350}
              description="Enter the value to filter"
            />
          )}
        </Stack>
        <Button
          onClick={reset}
          variant="outline"
          color="red"
          fullWidth
          size="xs"
        >
          Reset Filter
        </Button>
      </Menu.Dropdown>
    </Menu>
  );
};

export default RouterFilter;
