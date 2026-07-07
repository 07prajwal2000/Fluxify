import React from 'react';
import { SchemaProperty } from '../../../../types/schemaEditor';
import { Stack, NumberInput, TextInput, Divider, Text } from '@mantine/core';
import { getRuleValue, updateRule } from './ruleHelpers';

interface Props {
  property: SchemaProperty;
  onUpdate: (updates: Partial<SchemaProperty>) => void;
}

const StringRuleEditor = ({ property, onUpdate }: Props) => {
  const handleChange = (type: string, value: any) => {
    onUpdate({ rules: updateRule(property.rules, type, value) });
  };

  return (
    <Stack gap="md">
      <Text size="sm" fw={500}>String Validation Rules</Text>
      <NumberInput
        label="Minimum Length"
        placeholder="e.g. 3"
        min={0}
        value={getRuleValue(property.rules, 'minLength', '')}
        onChange={(val) => handleChange('minLength', val)}
      />
      <NumberInput
        label="Maximum Length"
        placeholder="e.g. 255"
        min={0}
        value={getRuleValue(property.rules, 'maxLength', '')}
        onChange={(val) => handleChange('maxLength', val)}
      />
      <Divider />
      <TextInput
        label="Regex Pattern"
        placeholder="e.g. ^[a-z]+$"
        value={getRuleValue(property.rules, 'regex')}
        onChange={(e) => handleChange('regex', e.currentTarget.value)}
      />
      <TextInput
        label="Starts With"
        value={getRuleValue(property.rules, 'startsWith')}
        onChange={(e) => handleChange('startsWith', e.currentTarget.value)}
      />
      <TextInput
        label="Ends With"
        value={getRuleValue(property.rules, 'endsWith')}
        onChange={(e) => handleChange('endsWith', e.currentTarget.value)}
      />
      <TextInput
        label="Contains"
        placeholder="e.g. hello"
        value={getRuleValue(property.rules, 'contains')}
        onChange={(e) => handleChange('contains', e.currentTarget.value)}
      />
      <TextInput
        label="Does Not Contain"
        placeholder="e.g. badword"
        value={getRuleValue(property.rules, 'notContains')}
        onChange={(e) => handleChange('notContains', e.currentTarget.value)}
      />
    </Stack>
  );
};

export default StringRuleEditor;
