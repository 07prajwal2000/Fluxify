import React from 'react';
import { SchemaProperty } from '../../../../types/schemaEditor';
import { Stack, Select, Text, TextInput, ActionIcon, Grid, Button, Divider } from '@mantine/core';
import { getRuleValue, updateRule } from './ruleHelpers';
import { TbTrashFilled } from 'react-icons/tb';

interface Props {
  property: SchemaProperty;
  onUpdate: (updates: Partial<SchemaProperty>) => void;
}

const ENUM_TYPES = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
];

const EnumRuleEditor = ({ property, onUpdate }: Props) => {
  const enumType = getRuleValue(property.rules, 'enumType', 'string');
  const enumValues = getRuleValue(property.rules, 'enumValues', []) as string[];

  const handleTypeChange = (type: string) => {
    onUpdate({ 
      rules: updateRule(updateRule(property.rules, 'enumType', type), 'enumValues', []) 
    });
  };

  const handleValuesChange = (values: string[]) => {
    onUpdate({ rules: updateRule(property.rules, 'enumValues', values) });
  };

  const addValue = () => {
    handleValuesChange([...enumValues, '']);
  };

  const updateValue = (index: number, val: string) => {
    const newValues = [...enumValues];
    newValues[index] = val;
    handleValuesChange(newValues);
  };

  const removeValue = (index: number) => {
    const newValues = enumValues.filter((_, i) => i !== index);
    handleValuesChange(newValues);
  };

  return (
    <Stack gap="md">
      <Text size="sm" fw={500}>Enum Configuration</Text>
      
      <Select
        allowDeselect={false}
        label="Enum Data Type"
        data={ENUM_TYPES}
        value={enumType}
        onChange={(val) => handleTypeChange(val || 'string')}
      />

      <Divider />

      <Text size="sm" fw={500}>Allowed Values</Text>
      
      {enumValues.map((val, index) => (
        <Grid key={index} align="center">
          <Grid.Col span={10}>
            <TextInput
              placeholder={`Value ${index + 1}`}
              value={val}
              onChange={(e) => updateValue(index, e.currentTarget.value)}
              type={enumType === 'number' ? 'number' : 'text'}
            />
          </Grid.Col>
          <Grid.Col span={2}>
            <ActionIcon color="red" variant="light" onClick={() => removeValue(index)}>
              <TbTrashFilled size={16} />
            </ActionIcon>
          </Grid.Col>
        </Grid>
      ))}

      <Button variant="light" color="violet" onClick={addValue}>
        Add New Value
      </Button>
    </Stack>
  );
};

export default EnumRuleEditor;
