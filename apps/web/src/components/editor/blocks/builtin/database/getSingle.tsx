import React, { useContext } from "react";
import { NodeProps } from "@xyflow/react";
import { TbDatabaseSearch, TbMenu2 } from "react-icons/tb";
import { Position } from "@xyflow/react";
import BaseBlock from "../../base";
import BlockHandle from "../../handle";
import { Box, Button, Group, Popover, Stack, Text } from "@mantine/core";
import z from "zod";
import { getSingleDbBlockSchema, joinSchema } from "@fluxify/blocks";
import IntegrationSelector from "@/components/editors/integrationSelector";
import { BlockCanvasContext } from "@/context/blockCanvas";
import JsTextInput from "@/components/editors/jsTextInput";
import ConditionsEditor from "@/components/editors/conditionsEditor";
import JoinsEditor from "@/components/editors/joinsEditor";
import ArrayEditor from "@/components/editors/arrayEditor";

const GetSingle = (props: NodeProps) => {
  return (
    <BaseBlock
      blockId={props.id}
      nodeProps={props}
      icon={
        <>
          <TbDatabaseSearch size={15} />
          <Text
            style={{
              position: "absolute",
              bottom: "-3px",
              right: "-5px",
              fontSize: "8px",
            }}
            fw={500}
            c="dark"
          >
            1
          </Text>
        </>
      }
      tooltip={props?.data?.label?.toString() ?? ""}
      showOptionsTooltip={!props.dragging}
      optionsTooltip={["delete", "options"]}
      blockName="Get Single Record"
      labelPlacement="left"
    >
      <BlockHandle
        type="source"
        blockId={`${props.id}`}
        position={Position.Bottom}
      />
      <BlockHandle
        type="target"
        blockId={`${props.id}`}
        position={Position.Top}
      />
    </BaseBlock>
  );
};

export function GetSingleFromDBSettingsPanel(props: {
  blockId: string;
  blockData: z.infer<typeof getSingleDbBlockSchema>;
}) {
  const { updateBlockData } = useContext(BlockCanvasContext);

  function onIntegrationSelect(id: string) {
    updateBlockData(props.blockId, {
      connection: id,
    });
  }
  function onTableNameChange(value: string) {
    updateBlockData(props.blockId, {
      tableName: value,
    });
  }
  function onConditionsChange(
    value: { lhs: any; rhs: any; operator: any; chain: any }[],
  ) {
    updateBlockData(props.blockId, {
      conditions: value.map((x) => ({
        attribute: x.lhs,
        value: x.rhs,
        operator: x.operator,
        chain: x.chain,
      })),
    });
  }

  function onJoinsChange(joins: z.infer<typeof joinSchema>[]) {
    updateBlockData(props.blockId, {
      joins,
    });
  }

  function onColumnChange(index: number, value: string) {
    const updated = [...(props.blockData.columns ?? ["*"])];
    updated[index] = value;
    updateBlockData(props.blockId, {
      columns: updated,
    });
  }

  function onAddColumn() {
    const updated = [...(props.blockData.columns ?? ["*"]), ""];
    updateBlockData(props.blockId, {
      columns: updated,
    });
  }

  function onRemoveColumn(index: number) {
    const updated = (props.blockData.columns ?? ["*"]).filter(
      (_, i) => i !== index,
    );
    updateBlockData(props.blockId, {
      columns: updated,
    });
  }

  return (
    <Stack px={"xs"}>
      <IntegrationSelector
        group="database"
        label="Choose Database Connection"
        description="Select the database connection to use for this block"
        selectedIntegration={props.blockData.connection}
        onSelect={onIntegrationSelect}
      />
      <Group align="flex-end" gap="xs">
        <Box flex={1}>
          <JsTextInput
            label="Table Name"
            description="Enter the table name to get the single record from or a JS expression that returns the table name"
            value={props.blockData.tableName}
            onValueChange={onTableNameChange}
          />
        </Box>
        <Popover position="right-start" withArrow shadow="md" width={280}>
          <Popover.Target>
            <Button
              variant="outline"
              color="violet"
              size="sm"
              leftSection={<TbMenu2 size={16} />}
            >
              Columns
            </Button>
          </Popover.Target>
          <Popover.Dropdown p="xs">
            <ArrayEditor
              title="Configure Columns"
              array={props.blockData.columns ?? ["*"]}
              onValueChange={onColumnChange}
              onAdd={onAddColumn}
              onRemove={onRemoveColumn}
              showAddButton
            />
          </Popover.Dropdown>
        </Popover>
      </Group>

      <JoinsEditor
        joins={props.blockData.joins ?? []}
        onChange={onJoinsChange}
      />

      <Stack gap={2}>
        <Text>Edit Condition(s)</Text>
        <Text size="xs" c={"gray"}>
          The conditions to use to get the single record from the table
        </Text>
        <Box my={2} />
        <ConditionsEditor
          conditions={
            props.blockData.conditions.map((condition) => ({
              ...condition,
              lhs: condition.attribute,
              rhs: condition.value,
            })) ?? []
          }
          ignoreOperators={["is_empty", "is_not_empty"]}
          onChange={onConditionsChange}
          disableJsConditions
        />
      </Stack>
    </Stack>
  );
}

export default GetSingle;

