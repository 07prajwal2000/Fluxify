import { Button, ActionIcon, Group, Text, Divider, Stack } from "@mantine/core";
import React from "react";
import { TbTrash } from "react-icons/tb";
import DebouncedTextInput from "./debouncedTextInput";

type Props = {
  title?: string;
  array: any[];
  onValueChange: (index: number, value: any) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
  showAddButton?: boolean;
  readonly?: boolean;
};

const ArrayEditor = (props: Props) => {
  return (
    <Stack gap={"xs"}>
      <Text size="md">{props.title || "Array Editor"}</Text>
      <Divider />
      {props.array.map((item, index) => (
        <Group w={"100%"} key={index} gap={"xs"} align="center">
          <DebouncedTextInput
            flex={1}
            debounceDelay={250}
            placeholder="Enter value"
            value={item || ""}
            onValueChange={(value) => props.onValueChange(index, value)}
            readOnly={props.readonly}
          />
          <ActionIcon
            onClick={() => props.onRemove(index)}
            variant="outline"
            color="red"
          >
            <TbTrash />
          </ActionIcon>
        </Group>
      ))}
      {props.array.length === 0 && (
        <Text my={4} ta="center" c="gray.6" size="sm">
          No items in the array
        </Text>
      )}
      {props.showAddButton && !props.readonly && (
        <Button
          variant="outline"
          size="xs"
          fullWidth
          color="violet"
          onClick={props.onAdd}
        >
          Add new item
        </Button>
      )}
    </Stack>
  );
};

export default ArrayEditor;
