import React, { useMemo } from 'react';
import { useSchemaEditorStore } from './store';
import { Drawer, Title, Box } from '@mantine/core';
import StringRuleEditor from './rules/StringRuleEditor';
import NumberRuleEditor from './rules/NumberRuleEditor';
import ArrayRuleEditor from './rules/ArrayRuleEditor';
import EnumRuleEditor from './rules/EnumRuleEditor';
import JSRuleEditor from './rules/JSRuleEditor';

const ConfigurationDrawer = () => {
  const drawerOpen = useSchemaEditorStore(state => state.drawerOpen);
  const closeDrawer = useSchemaEditorStore(state => state.closeDrawer);
  const activePropertyPath = useSchemaEditorStore(state => state.activePropertyPath);
  const schema = useSchemaEditorStore(state => state.schema);
  const updateProperty = useSchemaEditorStore(state => state.updateProperty);

  const activeProperty = useMemo(() => {
    if (!activePropertyPath) return null;
    let current: any = schema;
    for (const idx of activePropertyPath) {
      if (current.properties) {
        current = current.properties[idx];
      } else {
        return null;
      }
    }
    return current;
  }, [schema, activePropertyPath]);

  const handleUpdate = (updates: any) => {
    if (activePropertyPath) {
      updateProperty(activePropertyPath, updates);
    }
  };

  const renderEditor = () => {
    if (!activeProperty) return null;
    switch (activeProperty.dataType) {
      case 'str': return <StringRuleEditor property={activeProperty} onUpdate={handleUpdate} />;
      case 'int': 
      case 'float': return <NumberRuleEditor property={activeProperty} onUpdate={handleUpdate} />;
      case 'arr': return <ArrayRuleEditor property={activeProperty} onUpdate={handleUpdate} />;
      case 'enum': return <EnumRuleEditor property={activeProperty} onUpdate={handleUpdate} />;
      case 'js': return <JSRuleEditor property={activeProperty} onUpdate={handleUpdate} />;
      default: return <Box p="md">No specific configuration available for this type.</Box>;
    }
  };

  return (
    <Drawer
      opened={drawerOpen}
      onClose={closeDrawer}
      position="right"
      size="50%"
      title={<Title order={4}>Configure {activeProperty?.key ? `"${activeProperty.key}"` : 'Field'}</Title>}
    >
      <Box p="md">
        {renderEditor()}
      </Box>
    </Drawer>
  );
};

export default ConfigurationDrawer;
