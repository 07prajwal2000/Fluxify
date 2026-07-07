import React from 'react';
import { SchemaProperty } from '../../../../types/schemaEditor';
import { Stack, NumberInput, Select, Text, Divider, Alert } from '@mantine/core';
import { getRuleValue, updateRule } from './ruleHelpers';
import { TbInfoCircle } from 'react-icons/tb';

interface Props {
  property: SchemaProperty;
  onUpdate: (updates: Partial<SchemaProperty>) => void;
}

const ARRAY_ITEM_TYPES = [
  { value: 'str', label: 'String' },
  { value: 'int', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'bool', label: 'Boolean' },
  { value: 'object', label: 'Object' },
];

const ArrayRuleEditor = ({ property, onUpdate }: Props) => {
  const handleChange = (type: string, value: any) => {
    onUpdate({ rules: updateRule(property.rules, type, value) });
  };

  const itemType = getRuleValue(property.rules, 'itemType', '');

  return (
    <Stack gap="md">
      <Text size="sm" fw={500}>Array Validation Rules</Text>
      
      <Select
        allowDeselect={false}
        label="Items Data Type"
        placeholder="Select type for array items"
        data={ARRAY_ITEM_TYPES}
        value={itemType}
        onChange={(val) => handleChange('itemType', val)}
      />

      {itemType === 'object' && (
        <Alert icon={<TbInfoCircle size={16} />} title="Object Arrays" color="blue" variant="light">
          To define rules for objects inside this array, use the "Object" type directly on a parent field instead. Wait, currently array of objects requires custom JS or a different schema nesting. For now, it will validate that items are objects.
        </Alert>
      )}

      <Divider />

      <NumberInput
        label="Minimum Items"
        placeholder="e.g. 1"
        min={0}
        value={getRuleValue(property.rules, 'minItems', '')}
        onChange={(val) => handleChange('minItems', val)}
      />
      <NumberInput
        label="Maximum Items"
        placeholder="e.g. 10"
        min={0}
        value={getRuleValue(property.rules, 'maxItems', '')}
        onChange={(val) => handleChange('maxItems', val)}
      />
    </Stack>
  );
};

export default ArrayRuleEditor;
