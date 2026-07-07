import React, { useState } from 'react';
import { SchemaProperty, ValidationSchema, Rule } from '../../../types/schemaEditor';
import { Box, Collapse, Group, Text, ActionIcon } from '@mantine/core';
import { TbChevronRight, TbChevronDown } from 'react-icons/tb';

const renderRules = (rules?: Rule[]) => {
  if (!rules || rules.length === 0) return null;
  const parts = rules.filter(r => r.type !== 'jsCode').map(r => `${r.type}: ${r.value}`);
  if (parts.length === 0) return null;
  return ` (${parts.join(', ')})`;
};

const PreviewNode = ({ property }: { property: SchemaProperty }) => {
  const [opened, setOpened] = useState(true);
  const isObject = property.dataType === 'object' && (property.properties?.length ?? 0) > 0;
  const isArray = property.dataType === 'arr' && property.items;
  
  const hasChildren = isObject || isArray;

  return (
    <Box ml="md" mt={4}>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        {hasChildren ? (
          <ActionIcon 
            size="xs" 
            variant="transparent" 
            color="gray"
            onClick={() => setOpened(!opened)}
            style={{ marginTop: 2 }}
          >
            {opened ? <TbChevronDown size={14} /> : <TbChevronRight size={14} />}
          </ActionIcon>
        ) : (
          <Box w={16} />
        )}
        <Box>
          <Text size="sm" style={{ display: 'inline', fontFamily: 'monospace' }}>
            <Text span fw={600} c="violet">{property.key || '<unnamed>'}</Text>
            <Text span c="dimmed" ml="xs">
              : {property.dataType} 
              {property.required ? <Text span c="red"> *</Text> : ''}
              {renderRules(property.rules)}
            </Text>
          </Text>
          
          {hasChildren && (
            <Collapse in={opened}>
              <Box style={{ borderLeft: '1px solid var(--mantine-color-gray-3)' }}>
                {isObject && property.properties?.map((child, idx) => (
                  <PreviewNode key={child.id || child.key || idx} property={child} />
                ))}
                {isArray && property.items && (
                  <PreviewNode property={{ ...property.items, key: '[Item]' } as SchemaProperty} />
                )}
              </Box>
            </Collapse>
          )}
        </Box>
      </Group>
    </Box>
  );
};

export const SchemaPreview = ({ schema }: { schema: ValidationSchema }) => {
  if (schema.dataType === 'js') return null;

  return (
    <Box>
      {schema.properties?.length === 0 ? (
        <Text size="sm" c="dimmed" fs="italic">No properties defined.</Text>
      ) : (
        <Box style={{ border: '1px solid var(--mantine-color-gray-3)', borderRadius: 4, padding: '12px 0' }}>
          {schema.properties?.map((prop, idx) => (
            <PreviewNode key={prop.id || prop.key || idx} property={prop} />
          ))}
        </Box>
      )}
    </Box>
  );
};
