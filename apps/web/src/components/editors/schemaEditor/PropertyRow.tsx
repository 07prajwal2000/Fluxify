import React from 'react';
import { SchemaProperty, DataType } from '../../../types/schemaEditor';
import { useSchemaEditorStore } from './store';
import { Grid, TextInput, Select, Checkbox, ActionIcon, Box, Alert } from '@mantine/core';
import { TbSettings, TbTrash } from 'react-icons/tb';
import { TbInfoCircle } from 'react-icons/tb';
import { IoLogoJavascript } from "react-icons/io5";
import { useDisclosure } from '@mantine/hooks';
import JsEditorDialog from '../../dialog/jsEditorDialog';

interface PropertyRowProps {
  property: SchemaProperty;
  index: number;
  onUpdate: (updates: Partial<SchemaProperty>) => void;
  onRemove: () => void;
  onConfigure: () => void;
  pathStr: string;
}

const DATA_TYPES = [
  { value: 'str', label: 'String' },
  { value: 'int', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'bool', label: 'Boolean' },
  { value: 'arr', label: 'Array' },
  { value: 'object', label: 'Object' },
  { value: 'enum', label: 'Enum' },
  { value: 'js', label: 'Use JavaScript' },
];

const PropertyRow = ({ property, index, onUpdate, onRemove, onConfigure, pathStr }: PropertyRowProps) => {
  const [jsDialogOpened, { open: openJsDialog, close: closeJsDialog }] = useDisclosure(false);

  const locked = useSchemaEditorStore(state => state.locked);
  const typeOverrides = useSchemaEditorStore(state => state.typeOverrides);

  const overrideAllowedTypes = typeOverrides?.[pathStr];
  const isDataTypeLocked = locked && !overrideAllowedTypes;
  
  const allowedDataTypesOptions = overrideAllowedTypes 
    ? DATA_TYPES.filter(d => overrideAllowedTypes.includes(d.value as DataType))
    : DATA_TYPES;

  const handleJsSave = (val: string) => {
    onUpdate({ js: val });
    closeJsDialog();
  };

  const jsCode = property.js || 'return true;';

  return (
    <>
      <Grid align="center" mt="sm">
        <Grid.Col span={4}>
          <TextInput
            placeholder="Property Key"
            value={property.key}
            onChange={(e) => onUpdate({ key: e.currentTarget.value })}
            readOnly={locked}
            variant={locked ? 'filled' : 'default'}
          />
        </Grid.Col>
        <Grid.Col span={4}>
          <Select
            allowDeselect={false}
            data={allowedDataTypesOptions}
            value={property.dataType}
            onChange={(val) => onUpdate({ dataType: val as DataType })}
            readOnly={isDataTypeLocked}
            variant={isDataTypeLocked ? 'filled' : 'default'}
          />
        </Grid.Col>
        <Grid.Col span={2}>
          <Checkbox
            label="Required"
            color="violet"
            checked={property.required}
            onChange={(e) => onUpdate({ required: e.currentTarget.checked })}
            readOnly={locked}
            style={locked ? { pointerEvents: 'none', opacity: 0.6 } : undefined}
          />
        </Grid.Col>
        <Grid.Col span={2} style={{ display: 'flex', gap: '8px' }}>
          {property.dataType === 'js' ? (
            <ActionIcon variant="light" color="violet" onClick={openJsDialog}>
              <IoLogoJavascript size={20} />
            </ActionIcon>
          ) : property.dataType !== 'bool' ? (
            <ActionIcon variant="light" color="violet" onClick={onConfigure}>
              <TbSettings size={18} />
            </ActionIcon>
          ) : (
            <Box w={28} /> // Placeholder to keep layout consistent
          )}
          {!locked && (
            <ActionIcon variant="light" color="red" onClick={onRemove}>
              <TbTrash size={18} />
            </ActionIcon>
          )}
        </Grid.Col>
      </Grid>
      
      {property.dataType === 'js' && (
        <JsEditorDialog
          opened={jsDialogOpened}
          onClose={closeJsDialog}
          value={jsCode}
          onSave={handleJsSave}
          title={`Configure Custom JS for "${property.key || 'Field'}"`}
          description={
            <Alert icon={<TbInfoCircle size={16} />} color="violet" variant="light" mb="md">
              Write custom JavaScript to validate this property. Return a boolean to indicate pass/fail.
              To return a custom error response, use: <code>throw new ValidationError({`{ "your": "custom error object" }`})</code>.
            </Alert>
          }
        />
      )}
    </>
  );
};

export default PropertyRow;
