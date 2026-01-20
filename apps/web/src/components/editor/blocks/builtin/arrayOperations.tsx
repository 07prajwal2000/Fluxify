import React, { useContext, useMemo } from "react";
import BaseBlock from "../base";
import BlockHandle from "../handle";
import { NodeProps, Position, useNodes } from "@xyflow/react";
import { TbMatrix } from "react-icons/tb";
import { DataSettingsProps } from "../settingsDialog/blockSettingsDialog";
import { arrayOperationsBlockSchema } from "@fluxify/blocks";
import z from "zod";
import { BlockTypes } from "@/types/block";
import {
  Autocomplete,
  Box,
  Checkbox,
  Divider,
  Group,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { BlockCanvasContext } from "@/context/blockCanvas";
import JsTextInput from "@/components/editors/jsTextInput";
import { useDebouncedCallback } from "@mantine/hooks";
import VariableSelector from "@/components/editors/variableSelector";
import ConditionsEditor from "@/components/editors/conditionsEditor";

const ArrayOperations = (props: NodeProps) => {
  return (
    <BaseBlock
      blockId={props.id}
      nodeProps={props}
      icon={<TbMatrix size={15} />}
      tooltip={props?.data?.label?.toString() ?? ""}
      showOptionsTooltip={!props.dragging}
      optionsTooltip={["delete", "options"]}
      blockName="Array Operations"
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

export function ArrayOperationsHelpPanel(
  props: DataSettingsProps<z.infer<typeof arrayOperationsBlockSchema>>,
) {
  return <></>;
}

export function ArrayOperationsSettingsPanel(
  props: DataSettingsProps<z.infer<typeof arrayOperationsBlockSchema>>,
) {
  const data = props.blockData;
  const { updateBlockData } = useContext(BlockCanvasContext);
  const [value, setValue] = React.useState(data.value);
  const debouncedUpdate = useDebouncedCallback((value: string) => {
    updateBlockData(props.blockId, { value });
  }, 500);

  function onUseParamChange(value: boolean) {
    updateBlockData(props.blockId, { useParamAsInput: value });
  }
  function onDatasourceChange(value: string) {
    updateBlockData(props.blockId, { datasource: value });
  }
  function onOperationChange(value: string | null) {
    if (!value) return;
    updateBlockData(props.blockId, { operation: value });
  }
  function onJsExpressionChange(value: string) {
    debouncedUpdate(value);
    setValue(value);
  }
  function onConditionsChange(
    filterConditions: z.infer<
      typeof arrayOperationsBlockSchema
    >["filterConditions"],
  ) {
    updateBlockData(props.blockId, { filterConditions });
  }

  return (
    <Stack>
      <VariableSelector
        label="Datasource"
        placeholder="Type to search or enter variable name"
        description="Choose a variable which contains the target array on which operation will be performed"
        value={data.datasource}
        onChange={onDatasourceChange}
      />
      <Group gap={"xl"}>
        <Select
          label="Operation"
          placeholder="Select an operation"
          description="Select an operation to perform on the array"
          value={data.operation}
          onChange={onOperationChange}
          data={[
            { value: "push", label: "Push" },
            { value: "pop", label: "Pop" },
            { value: "shift", label: "Shift" },
            { value: "unshift", label: "Unshift" },
            { value: "filter", label: "Filter" },
          ]}
        />
        <Checkbox
          label="Use Param"
          description="Use input parameter as the datasource?"
          checked={props.blockData.useParamAsInput as boolean}
          onChange={(e) => onUseParamChange(e.target.checked)}
        />
      </Group>
      {props.blockData.useParamAsInput === false &&
        (data.operation === "push" || data.operation === "unshift") && (
          <JsTextInput
            label="Value"
            description="Operation is performed on the datasource with this value (can be Js expression !)"
            value={value}
            onValueChange={onJsExpressionChange}
          />
        )}
      {data.operation === "filter" && (
        <Stack px={"sm"} gap={"xs"}>
          <Text size="lg">Add/Edit Conditions</Text>
          <Divider />
          <Group gap={"xs"} p={"sm"} bg={"gray.1"} bdrs="sm">
            <Text fw={"bold"} size="sm">
              Tip :
            </Text>
            <Text size="xs">
              Use JS expression to access the value of the array element in{" "}
              <code>input</code> variable.
            </Text>
          </Group>
          <ConditionsEditor
            onChange={onConditionsChange}
            conditions={props.blockData.filterConditions || []}
          />
        </Stack>
      )}
    </Stack>
  );
}

export default ArrayOperations;
