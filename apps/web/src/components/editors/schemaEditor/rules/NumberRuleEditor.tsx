import React from 'react';
import { SchemaProperty } from '../../../../types/schemaEditor';
import { Stack, NumberInput, Divider, Text } from '@mantine/core';
import { getRuleValue, updateRule } from './ruleHelpers';

interface Props {
  property: SchemaProperty;
  onUpdate: (updates: Partial<SchemaProperty>) => void;
}

const NumberRuleEditor = ({ property, onUpdate }: Props) => {
  const handleChange = (type: string, value: any) => {
    onUpdate({ rules: updateRule(property.rules, type, value) });
  };

  const isFloat = property.dataType === 'float';

  return (
    <Stack gap="md">
      <Text size="sm" fw={500}>Number Validation Rules</Text>
      <NumberInput
        label="Minimum Value"
        placeholder="e.g. 0"
        decimalScale={isFloat ? undefined : 0}
        value={getRuleValue(property.rules, 'min', '')}
        onChange={(val) => handleChange('min', val)}
      />
      <NumberInput
        label="Maximum Value"
        placeholder="e.g. 100"
        decimalScale={isFloat ? undefined : 0}
        value={getRuleValue(property.rules, 'max', '')}
        onChange={(val) => handleChange('max', val)}
      />
      <Divider />
      <NumberInput
        label="Exactly Equal To"
        decimalScale={isFloat ? undefined : 0}
        value={getRuleValue(property.rules, 'equal', '')}
        onChange={(val) => handleChange('equal', val)}
      />
      <NumberInput
        label="Not Equal To"
        decimalScale={isFloat ? undefined : 0}
        value={getRuleValue(property.rules, 'notEqual', '')}
        onChange={(val) => handleChange('notEqual', val)}
      />
    </Stack>
  );
};

export default NumberRuleEditor;
