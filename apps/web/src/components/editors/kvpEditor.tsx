import { ActionIcon, Button, Grid, Stack, TextInput, Select, NumberInput } from "@mantine/core";
import React, { useState, useEffect } from "react";
import { TbTrashFilled } from "react-icons/tb";
import JsTextInput from "./jsTextInput";
import { SchemaProperty } from "@/types/schemaEditor";

type InputType = "text" | "js text";

type PropTypes = {
  data: Record<string, string>;
  onDataChange?: (data: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  inputType?: InputType;
  allowDuplicateKeys?: boolean;
  addButtonText?: string;
  schemaProperties?: SchemaProperty[];
};

const KVPEditor = ({
  data,
  onDataChange,
  keyPlaceholder = "Key",
  valuePlaceholder = "Value",
  inputType = "text",
  addButtonText = "Add New Key-Value Pair",
  schemaProperties,
}: PropTypes) => {
  const [tempData, setTempData] = useState<[string, string][]>(() => Object.entries(data));

  // Sync when data changes structurally (e.g., initialized asynchronously)
  useEffect(() => {
    // Only update if lengths differ to avoid overwriting typed uncommitted changes, 
    // or if the component just mounted with new keys. This is a basic sync.
    if (Object.keys(data).length !== tempData.length && Object.keys(data).length > 0) {
      setTempData(Object.entries(data));
    }
  }, [data]);

  const handleKeyValueChange = (key: string, value: string, index: number) => {
    const newData = [...tempData];
    newData[index] = [key, value];
    setTempData(newData);
    onDataChange?.(Object.fromEntries(newData));
  };

  const handleAddNewPair = () => {
    const newData: [string, string][] = [...tempData, ["", ""]];
    setTempData(newData);
    onDataChange?.(Object.fromEntries(newData));
  };

  const handleDeletePair = (index: number) => {
    const newData = tempData.filter((_, i) => i !== index);
    setTempData(newData);
    onDataChange?.(Object.fromEntries(newData));
  };

  const renderInput = (
    value: string,
    onChange: (value: string) => void,
    placeholder: string
  ) => {
    return inputType === "js text" ? (
      <JsTextInput
        placeholder={placeholder}
        value={value}
        onValueChange={(e) => onChange(e)}
      />
    ) : (
      <TextInput
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
      />
    );
  };

  const renderValueInput = (
    key: string,
    value: string,
    onChange: (value: string) => void,
    placeholder: string
  ) => {
    const propDef = schemaProperties?.find((p) => p.key === key);
    if (propDef) {
      if (propDef.dataType === "bool") {
        return (
          <Select
            data={["true", "false"]}
            value={value || "false"}
            onChange={(v) => onChange(v || "false")}
            placeholder={placeholder}
          />
        );
      }
      if (propDef.dataType === "int" || propDef.dataType === "float") {
        return (
          <NumberInput
            value={value ? Number(value) : ""}
            onChange={(v) => onChange(v === "" ? "" : String(v))}
            placeholder={placeholder}
          />
        );
      }
      if (propDef.dataType === "enum") {
        const enumRule = propDef.rules?.find((r) => r.type === "enum");
        if (enumRule && Array.isArray(enumRule.value)) {
          return (
            <Select
              data={enumRule.value.map(String)}
              value={value}
              onChange={(v) => onChange(v || "")}
              placeholder={placeholder}
            />
          );
        }
      }
    }
    return renderInput(value, onChange, placeholder);
  };

  return (
    <Stack>
      {tempData.map(([key, value], index) => (
        <Grid key={index} align="center">
          <Grid.Col span={5}>
            {renderInput(
              key,
              (newValue) => handleKeyValueChange(newValue, value, index),
              keyPlaceholder
            )}
          </Grid.Col>
          <Grid.Col span={6}>
            {renderValueInput(
              key,
              value,
              (newValue) => handleKeyValueChange(key, newValue, index),
              valuePlaceholder
            )}
          </Grid.Col>
          <Grid.Col span={1}>
            <ActionIcon color="red" onClick={() => handleDeletePair(index)}>
              <TbTrashFilled size={16} />
            </ActionIcon>
          </Grid.Col>
        </Grid>
      ))}
      <Button
        color="violet"
        onClick={handleAddNewPair}
        fullWidth
        style={{ marginTop: "0.5rem" }}
      >
        {addButtonText}
      </Button>
    </Stack>
  );
};

export default KVPEditor;
