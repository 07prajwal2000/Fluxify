import React, { useContext } from "react";
import BaseBlock from "../../base";
import { NodeProps } from "@xyflow/react";
import { Position } from "@xyflow/react";
import {
  Box,
  Grid,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import BlockHandle from "../../handle";
import { TbDatabaseSearch } from "react-icons/tb";
import z from "zod";
import { getAllDbBlockSchema } from "@fluxify/blocks";
import ConditionsEditor from "@/components/editors/conditionsEditor";
import IntegrationSelector from "@/components/editors/integrationSelector";
import JsTextInput from "@/components/editors/jsTextInput";
import { BlockCanvasContext } from "@/context/blockCanvas";

const GetAll = (props: NodeProps) => {
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
              right: "-7px",
              fontSize: "8px",
            }}
            fw={500}
            c="dark"
          >
            ...
          </Text>
        </>
      }
      tooltip={props?.data?.label?.toString() ?? ""}
      showOptionsTooltip={!props.dragging}
      optionsTooltip={["delete", "options"]}
      blockName="Get All Records"
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

export function GetAllBlockDataSettingsPanel(props: {
  blockData: z.infer<typeof getAllDbBlockSchema>;
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
        attribute: x.lhs,
        value: x.rhs,
        operator: x.operator,
        chain: x.chain,
      })),
    });
  }

  function onLimitChange(value: number | string) {
    updateBlockData(props.blockId, {
      limit: value,
    });
  }

  function onOffsetChange(value: number | string) {
    updateBlockData(props.blockId, {
      offset: value,
    });
  }

  function onSortAttributeChange(value: string) {
    updateBlockData(props.blockId, {
      sort: {
        attribute: value,
        direction: props.blockData.sort.direction,
      },
    });
  }

  function onSortDirectionChange(value: string) {
    updateBlockData(props.blockId, {
      sort: {
        attribute: props.blockData.sort.attribute,
        direction: value,
      },
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
        flex={2}
        label="Table Name"
        description="Enter the table name to get all records from or a JS expression that returns the table name"
        value={props.blockData.tableName}
        onValueChange={onTableNameChange}
      />
      <Grid columns={2} align="center" justify="center">
        <Grid.Col span={1}>
          <JsTextInput
            flex={1}
            defaultValue={500}
            label="Limit"
            description="Enter the limit to use for this block"
            value={props.blockData.limit}
            type="number"
            onValueChange={onLimitChange}
          />
        </Grid.Col>
        <Grid.Col span={1}>
          <JsTextInput
            type="number"
            flex={1}
            defaultValue={0}
            label="Offset"
            description="Enter the offset to use for this block"
            value={props.blockData.offset}
            onValueChange={onOffsetChange}
          />
        </Grid.Col>
        <Grid.Col span={1}>
          <JsTextInput
            flex={1}
            label="Sort Attribute"
            description="Enter the sort column/attribute to use on the table"
            value={props.blockData.sort.attribute}
            onValueChange={onSortAttributeChange}
          />
        </Grid.Col>
        <Grid.Col span={1}>
          <Select
            flex={1}
            label="Sort"
            data={[
              { value: "asc", label: "Ascending" },
              { value: "desc", label: "Descending" },
            ]}
            description="Enter the sort direction to use on the table"
            value={props.blockData.sort.direction}
            allowDeselect={false}
            onChange={(value) => onSortDirectionChange(value!)}
          />
        </Grid.Col>
      </Grid>
      <Stack gap={2}>
        <Text>Edit Condition(s)</Text>
        <Text size="xs" c={"gray"}>
          The conditions to use to get all records from the table
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
          onChange={onConditionsChange}
          disableJsConditions
        />
      </Stack>
    </Stack>
  );
}

export default GetAll;
