import { useBlockDataStore } from "@/store/blockDataStore";
import { BlockTypes } from "@/types/block";
import { Autocomplete, AutocompleteProps } from "@mantine/core";
import { useNodes } from "@xyflow/react";
import React, { useMemo } from "react";

const VariableSelector = (props: AutocompleteProps) => {
  const nodes = useNodes().filter((block) => block.type === BlockTypes.setvar);
  const blockDataStore = useBlockDataStore();
  const availableVariables = useMemo(() => {
    const variables = [] as string[];
    for (let block of nodes) {
      if (variables.includes(blockDataStore[block.id].key)) {
        continue;
      }
      variables.push(blockDataStore[block.id].key);
    }
    return variables;
  }, [blockDataStore]);

  return (
    <Autocomplete
      {...props}
      placeholder="Type to search or enter variable name"
      data={availableVariables}
    />
  );
};

export default VariableSelector;
