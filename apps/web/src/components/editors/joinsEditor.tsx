import React from "react";
import z from "zod";
import { joinSchema } from "@fluxify/blocks";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { TbPlus, TbTrash } from "react-icons/tb";
import DebouncedTextInput from "./debouncedTextInput";

type JoinType = z.infer<typeof joinSchema>;

interface Props {
  joins: JoinType[];
  onChange?: (joins: JoinType[]) => void;
  readonly?: boolean;
}

const joinTypeOptions = [
  { value: "left", label: "Left Join" },
  { value: "inner", label: "Inner Join" },
  { value: "right", label: "Right Join" },
  { value: "outer", label: "Outer Join" },
];

const JoinsEditor = ({ joins = [], onChange, readonly }: Props) => {
  const onAddJoin = () => {
    const updated = [
      ...joins,
      {
        type: "left" as const,
        table: "",
        attribute: "",
      },
    ];
    onChange?.(updated);
  };

  const onRemoveJoin = (index: number) => {
    const updated = joins.filter((_, i) => i !== index);
    onChange?.(updated);
  };

  const onUpdateJoin = (index: number, updatedFields: Partial<JoinType>) => {
    const updated = joins.map((j, i) => {
      if (i === index) {
        return { ...j, ...updatedFields };
      }
      return j;
    });
    onChange?.(updated);
  };

  return (
    <Stack gap="xs">
      <Group justify="space-between" align="center">
        <Box>
          <Text fw={500} size="sm">
            Joins (Optional)
          </Text>
          <Text size="xs" c="gray">
            Configure table joins for the query
          </Text>
        </Box>
      </Group>

      {joins.map((join, index) => {
        const rawAttr = join.attribute || "";
        const equalsIndex = rawAttr.indexOf("=");
        const leftAttr =
          equalsIndex !== -1 ? rawAttr.slice(0, equalsIndex).trim() : rawAttr;
        const rightAttr =
          equalsIndex !== -1 ? rawAttr.slice(equalsIndex + 1).trim() : "";

        return (
          <Group key={index} gap="xs" align="center" wrap="nowrap" w="100%">
            <Select
              size="xs"
              style={{ width: 110 }}
              data={joinTypeOptions}
              value={join.type || "left"}
              allowDeselect={false}
              readOnly={readonly}
              onChange={(val) =>
                onUpdateJoin(index, {
                  type: (val as JoinType["type"]) || "left",
                })
              }
            />

            <DebouncedTextInput
              size="xs"
              flex={2}
              placeholder="orders"
              value={join.table || ""}
              readOnly={readonly}
              onValueChange={(val) => onUpdateJoin(index, { table: val })}
            />

            <DebouncedTextInput
              size="xs"
              flex={2}
              placeholder="users.id"
              value={leftAttr}
              readOnly={readonly}
              onValueChange={(val) => {
                const newAttr = rightAttr ? `${val} = ${rightAttr}` : val;
                onUpdateJoin(index, { attribute: newAttr });
              }}
            />

            <Text size="xs" fw={700} c="gray.6">
              =
            </Text>

            <DebouncedTextInput
              size="xs"
              flex={2}
              placeholder="orders.user_id"
              value={rightAttr}
              readOnly={readonly}
              onValueChange={(val) => {
                const newAttr = `${leftAttr} = ${val}`;
                onUpdateJoin(index, { attribute: newAttr });
              }}
            />

            <ActionIcon
              size="sm"
              variant="outline"
              color="red"
              disabled={readonly}
              onClick={() => onRemoveJoin(index)}
            >
              <TbTrash size={14} />
            </ActionIcon>
          </Group>
        );
      })}

      {joins.length === 0 && (
        <Text ta="center" c="gray.6" size="xs" my={2}>
          No joins added
        </Text>
      )}

      {!readonly && (
        <Button
          variant="outline"
          size="xs"
          fullWidth
          color="violet"
          leftSection={<TbPlus size={14} />}
          onClick={onAddJoin}
        >
          Add Another Join
        </Button>
      )}
    </Stack>
  );
};

export default JoinsEditor;
