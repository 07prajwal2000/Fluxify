"use client";

import React, { useRef, useState } from 'react';
import { SchemaEditor } from '../../components/editors/schemaEditor/SchemaEditor';
import { SchemaEditorRef, ValidationSchema } from '../../types/schemaEditor';
import { Button, Container, Title, Box, Text } from '@mantine/core';

export default function TestSchemaPage() {
  const editorRef = useRef<SchemaEditorRef>(null);
  const [savedData, setSavedData] = useState<ValidationSchema | null>(null);

  const handleSave = (data: ValidationSchema) => {
    setSavedData(data);
  };

  const triggerSave = () => {
    if (editorRef.current) {
      editorRef.current.save();
    }
  };

  return (
    <Container size="lg" py="xl">
      <Title order={2} mb="md">Schema Editor Test</Title>
      
      <SchemaEditor 
        ref={editorRef} 
        onSave={handleSave} 
      />

      <Box mt="xl">
        <Button onClick={triggerSave}>Trigger Save from Parent</Button>
      </Box>

      {savedData && (
        <Box mt="md" p="md" style={{ backgroundColor: '#f8f9fa', borderRadius: '8px' }}>
          <Text fw={500}>Saved JSON Output:</Text>
          <pre>{JSON.stringify(savedData, null, 2)}</pre>
        </Box>
      )}
    </Container>
  );
}
