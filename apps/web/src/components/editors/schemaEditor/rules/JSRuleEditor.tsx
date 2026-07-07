import React from 'react';
import { SchemaProperty } from '../../../../types/schemaEditor';
import { Stack, Text, Alert } from '@mantine/core';
import { getRuleValue, updateRule } from './ruleHelpers';
import JsEditor from '../../jsEditor';
import { TbInfoCircle } from 'react-icons/tb';

interface Props {
  property: SchemaProperty;
  onUpdate: (updates: Partial<SchemaProperty>) => void;
}

const JSRuleEditor = ({ property, onUpdate }: Props) => {
  const jsCode = getRuleValue(property.rules, 'jsCode', 'return true;');

  const handleChange = (val: string) => {
    onUpdate({ rules: updateRule(property.rules, 'jsCode', val) });
  };

  return (
    <Stack gap="md">
      <Text size="sm" fw={500}>Custom JavaScript Validation</Text>
      
      <Alert icon={<TbInfoCircle size={16} />} color="violet" variant="light">
        Write JavaScript code that evaluates this property. It should return a boolean value indicating if the validation passed.
        You can access the field's value typically via context (e.g. `input`).
      </Alert>

      <div style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 4, overflow: 'hidden' }}>
        <JsEditor
          value={jsCode}
          onChange={handleChange}
          height={300}
        />
      </div>
    </Stack>
  );
};

export default JSRuleEditor;
