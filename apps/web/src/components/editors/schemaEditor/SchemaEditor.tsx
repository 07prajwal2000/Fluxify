import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { SchemaEditorContext, createSchemaStore, useSchemaEditorStore } from './store';
import { ValidationSchema, SchemaEditorRef, DataType } from '../../../types/schemaEditor';
import { Box, Paper, Tabs, Alert } from '@mantine/core';
import SchemaSlide from './SchemaSlide';
import ConfigurationDrawer from './ConfigurationDrawer';
import { TbLayoutDashboard, TbInfoCircle, TbEye } from 'react-icons/tb';
import { IoLogoJavascript } from 'react-icons/io5';
import JsEditor from '../jsEditor';
import { SchemaPreview } from './SchemaPreview';

interface SchemaEditorProps {
  initialData?: ValidationSchema;
  onSave?: (data: ValidationSchema) => void;
  locked?: boolean;
  typeOverrides?: Record<string, DataType[]>;
  allowedRootSchemaTypes?: DataType[];
}

const SchemaEditorContent = forwardRef<SchemaEditorRef, SchemaEditorProps>(({ onSave }, ref) => {
  const schema = useSchemaEditorStore(state => state.schema);
  const setSchema = useSchemaEditorStore(state => state.setSchema);

  useImperativeHandle(ref, () => ({
    save: () => {
      onSave?.(schema);
    },
    getSchema: () => schema
  }));

  const isRootJs = schema.dataType === 'js';
  const rootJsCode = schema.js || 'return true;';

  const [activeTab, setActiveTab] = React.useState<string | null>(isRootJs ? 'js' : 'ui');

  const handleTabChange = (val: string | null) => {
    setActiveTab(val);
    if (val === 'js') {
      setSchema({ 
        ...schema, 
        dataType: 'js', 
        js: schema.js || 'return true;' 
      });
    } else if (val === 'ui') {
      if (schema.dataType === 'js') {
        setSchema({ 
          ...schema, 
          dataType: 'object' 
        });
      }
    }
  };

  const handleRootJsChange = (val: string) => {
    setSchema({
      ...schema,
      js: val
    });
  };

  return (
    <Box style={{ position: 'relative' }}>
      <Tabs value={activeTab} onChange={handleTabChange} color="violet">
        <Tabs.List>
          <Tabs.Tab value="ui" leftSection={<TbLayoutDashboard size={16} />}>Schema Editor</Tabs.Tab>
          <Tabs.Tab value="js" leftSection={<IoLogoJavascript size={16} />}>Custom JS</Tabs.Tab>
          {!isRootJs && <Tabs.Tab value="preview" leftSection={<TbEye size={16} />}>Preview</Tabs.Tab>}
        </Tabs.List>
        
        <Tabs.Panel value="ui" pt="md">
          <Paper withBorder p="md" radius="md">
            <SchemaSlide />
          </Paper>
          <ConfigurationDrawer />
        </Tabs.Panel>
        
        <Tabs.Panel value="js" pt="md">
          <Paper withBorder p="md" radius="md">
            <Alert icon={<TbInfoCircle size={16} />} color="violet" variant="light" mb="md">
              Write custom JavaScript to validate the entire request. Return a boolean to indicate pass/fail. 
              To return a custom error response, use: <code>throw new ValidationError({`{ "your": "custom error object" }`})</code>.
            </Alert>
            <Box style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 4, overflow: 'hidden' }}>
              <JsEditor
                value={rootJsCode}
                onChange={handleRootJsChange}
                height={400}
              />
            </Box>
          </Paper>
        </Tabs.Panel>

        {!isRootJs && (
          <Tabs.Panel value="preview" pt="md">
            <Paper withBorder p="md" radius="md">
              <SchemaPreview schema={schema} />
            </Paper>
          </Tabs.Panel>
        )}
      </Tabs>
    </Box>
  );
});

SchemaEditorContent.displayName = 'SchemaEditorContent';

export const SchemaEditor = forwardRef<SchemaEditorRef, SchemaEditorProps>(({ initialData, locked, typeOverrides, allowedRootSchemaTypes, ...props }, ref) => {
  const storeRef = useRef(createSchemaStore(initialData, locked, typeOverrides, allowedRootSchemaTypes));

  return (
    <SchemaEditorContext.Provider value={storeRef.current}>
      <SchemaEditorContent ref={ref} {...props} />
    </SchemaEditorContext.Provider>
  );
});

SchemaEditor.displayName = 'SchemaEditor';
export default SchemaEditor;
