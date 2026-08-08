import React, { useContext } from "react";
import BaseBlock from "../../base";
import BlockHandle from "../../handle";
import { NodeProps } from "@xyflow/react";
import { Position } from "@xyflow/react";
import { TbDatabaseX } from "react-icons/tb";
import { deleteDbBlockSchema } from "@fluxify/blocks";
import z from "zod";
import { Box, Stack, Text } from "@mantine/core";
import IntegrationSelector from "@/components/editors/integrationSelector";
import ConditionsEditor from "@/components/editors/conditionsEditor";
import JsTextInput from "@/components/editors/jsTextInput";
import { BlockCanvasContext } from "@/context/blockCanvas";

const Delete = (props: NodeProps) => {
  return (
    <BaseBlock
      blockId={props.id}
      nodeProps={props}
      icon={<TbDatabaseX size={15} />}
      tooltip={props?.data?.label?.toString() ?? ""}
      showOptionsTooltip={!props.dragging}
      optionsTooltip={["delete", "options"]}
      blockName="Delete Record(s)"
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

export function DeleteBlockDataSettingsPanel(props: {
  blockData: z.infer<typeof deleteDbBlockSchema>;
  blockId: string;
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
        attribute: { kind: "column" as const, value: x.lhs },
        value: { kind: "literal" as const, value: x.rhs },
        operator: x.operator,
        chain: x.chain,
      })),
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
      <JsTextInput
        label="Table Name"
        description="Enter the table name to delete the record(s) from or a JS expression that returns the table name"
        value={props.blockData.tableName}
        onValueChange={onTableNameChange}
      />
      <Stack gap={2}>
        <Text>Edit Condition(s)</Text>
        <Text size="xs" c={"gray"}>
          The conditions to use to delete the record(s) from the table
        </Text>
        <Box my={2} />
        <ConditionsEditor
          conditions={
            props.blockData.conditions.map((condition) => ({
              ...condition,
              lhs: condition.attribute.value,
              rhs: condition.value.value,
            })) ?? []
          }
          onChange={onConditionsChange}
          disableJsConditions
          ignoreOperators={["is_empty", "is_not_empty"]}
        />
      </Stack>
    </Stack>
  );
}

export default Delete;
