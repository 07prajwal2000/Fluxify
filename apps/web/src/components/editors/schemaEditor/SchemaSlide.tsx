import React, { useMemo } from 'react';
import { useSchemaEditorStore } from './store';
import { Box, Button, Stack, Text, Breadcrumbs, Anchor, Alert, Group, NumberInput, Select, ActionIcon, Divider, Accordion } from '@mantine/core';
import PropertyRow from './PropertyRow';
import { TbPlus, TbInfoCircle, TbSettings } from 'react-icons/tb';
import { getRuleValue, updateRule } from './rules/ruleHelpers';
import { DataType } from '../../../types/schemaEditor';

const DATA_TYPES = [
  { value: 'str', label: 'String' },
  { value: 'int', label: 'Integer' },
  { value: 'float', label: 'Float' },
  { value: 'bool', label: 'Boolean' },
  { value: 'arr', label: 'Array' },
  { value: 'object', label: 'Object' },
  { value: 'enum', label: 'Enum' },
  { value: 'js', label: 'Write JavaScript' },
];

const SchemaSlide = () => {
  const schema = useSchemaEditorStore(state => state.schema);
  const locked = useSchemaEditorStore(state => state.locked);
  const allowedRootSchemaTypes = useSchemaEditorStore(state => state.allowedRootSchemaTypes);
  const setSchema = useSchemaEditorStore(state => state.setSchema);
  const path = useSchemaEditorStore(state => state.path);
  const addProperty = useSchemaEditorStore(state => state.addProperty);
  const removeProperty = useSchemaEditorStore(state => state.removeProperty);
  const updateProperty = useSchemaEditorStore(state => state.updateProperty);
  const openDrawer = useSchemaEditorStore(state => state.openDrawer);
  const pushPath = useSchemaEditorStore(state => state.pushPath);
  const goToPath = useSchemaEditorStore(state => state.goToPath);

  const { currentTarget, currentProperties, breadcrumbItems } = useMemo(() => {
    let current: any = schema;
    const items = [{ title: 'Main Schema', level: 0 }];
    
    for (let i = 0; i < path.length; i++) {
      const segment = path[i];
      if (segment === 'items') {
        items.push({ 
          title: 'Array Items [ ]',
          level: i + 1 
        });
        current = current.items || { dataType: 'str' };
      } else {
        if (current.properties && current.properties[segment]) {
          items.push({ 
            title: current.properties[segment].key || `Property ${segment}`,
            level: i + 1 
          });
          current = current.properties[segment];
        }
      }
    }
    
    return {
      currentTarget: current,
      currentProperties: current?.properties || [],
      breadcrumbItems: items
    };
  }, [schema, path]);

  const currentPathStr = useMemo(() => {
    let str = '';
    let curr: any = schema;
    for (let i = 0; i < path.length; i++) {
      const seg = path[i];
      if (seg === 'items') {
        str += str ? '[]' : '[]';
        curr = curr.items || { dataType: 'str' };
      } else {
        const key = curr.properties[seg]?.key || '';
        str += str ? `.${key}` : key;
        curr = curr.properties[seg];
      }
    }
    return str;
  }, [schema, path]);

  const handleConfigureProperty = (index: number) => {
    const prop = currentProperties[index];
    if (prop.dataType === 'object' || prop.dataType === 'arr') {
      pushPath(index);
    } else {
      openDrawer([...path, index]);
    }
  };

  const renderArrayConfig = () => {
    const itemsSchema = currentTarget.items || { dataType: 'str' };

    const handleConfigureItems = () => {
      if (itemsSchema.dataType === 'object' || itemsSchema.dataType === 'arr') {
        pushPath('items');
      } else {
        openDrawer([...path, 'items']);
      }
    };

    return (
      <Stack gap="md" mt="md">
        <Group grow>
          <NumberInput
            label="Minimum Items"
            placeholder="e.g. 1"
            min={0}
            value={getRuleValue(currentTarget.rules, 'minItems', '')}
            onChange={(val) => updateProperty(path, { rules: updateRule(currentTarget.rules, 'minItems', val) })}
          />
          <NumberInput
            label="Maximum Items"
            placeholder="e.g. 10"
            min={0}
            value={getRuleValue(currentTarget.rules, 'maxItems', '')}
            onChange={(val) => updateProperty(path, { rules: updateRule(currentTarget.rules, 'maxItems', val) })}
          />
        </Group>

        <Divider my="sm" />
        
        <Text size="sm" fw={500}>Array Items Data Type</Text>
        <Group align="center">
          <Select
            allowDeselect={false}
            data={DATA_TYPES}
            value={itemsSchema.dataType}
            onChange={(val) => updateProperty([...path, 'items'], { dataType: val as DataType })}
            style={{ flex: 1 }}
            readOnly={locked}
          />
          <ActionIcon size="lg" variant="light" color="violet" onClick={handleConfigureItems}>
            <TbSettings size={20} />
          </ActionIcon>
        </Group>
      </Stack>
    );
  };

  return (
    <Box>
      <Group mb="md">
        <Breadcrumbs separator="→">
          {breadcrumbItems.map((item, index) => (
            <Anchor 
              key={index} 
              onClick={() => goToPath(item.level)}
              c={index === breadcrumbItems.length - 1 ? 'dimmed' : 'violet'}
              style={{ cursor: index === breadcrumbItems.length - 1 ? 'default' : 'pointer' }}
            >
              {item.title}
            </Anchor>
          ))}
        </Breadcrumbs>
      </Group>

      {!locked && path.length === 0 && (!allowedRootSchemaTypes || allowedRootSchemaTypes.length > 1) && (
        <Group mb="md" align="center">
          <Text fw={500} size="sm">Root Schema Type:</Text>
          <Select
            allowDeselect={false}
            data={DATA_TYPES.filter(d => d.value !== 'js' && (!allowedRootSchemaTypes || allowedRootSchemaTypes.includes(d.value as DataType)))}
            value={schema.dataType}
            onChange={(val) => setSchema({ ...schema, dataType: val as DataType })}
            style={{ width: 150 }}
          />
        </Group>
      )}

      {currentTarget.dataType === 'arr' ? (
        renderArrayConfig()
      ) : currentTarget.dataType === 'object' ? (
        <>
          {!locked && (
            <Accordion variant="separated" mb="md" styles={{ item: { border: '1px solid var(--mantine-color-violet-light-border)', backgroundColor: 'var(--mantine-color-violet-light)' }, control: { padding: '12px' } }}>
              <Accordion.Item value="info">
                <Accordion.Control icon={<TbInfoCircle size={16} color="var(--mantine-color-violet-filled)" />}>
                  <Text size="sm" fw={500} c="violet">Recursive Schema Info</Text>
                </Accordion.Control>
                <Accordion.Panel>
                  <Text size="sm" c="violet.9">
                    If you need to build recursive schemas, please select the "Write JavaScript" data type for that property and provide custom validation logic. The UI editor currently doesn't natively support cyclic references.
                  </Text>
                </Accordion.Panel>
              </Accordion.Item>
            </Accordion>
          )}

          <Stack gap="xs">
            {currentProperties.length === 0 && (
              <Text c="dimmed" size="sm" fs="italic">No properties added yet.</Text>
            )}
            {currentProperties.map((prop: any, index: number) => {
              const propPathStr = currentPathStr ? `${currentPathStr}.${prop.key}` : prop.key;
              return (
                <PropertyRow
                  key={prop.id || index}
                  index={index}
                  property={prop}
                  pathStr={propPathStr}
                  onUpdate={(updates) => updateProperty([...path, index], updates)}
                  onRemove={() => removeProperty([...path, index])}
                  onConfigure={() => handleConfigureProperty(index)}
                />
              );
            })}
          </Stack>

          {!locked && (
            <Button
              mt="lg"
              leftSection={<TbPlus size={16} />}
              variant="light"
              color="violet"
              onClick={() => addProperty(path)}
            >
              Add Property
            </Button>
          )}
        </>
      ) : (
        <Stack align="flex-start" mt="md">
          <Text size="sm">
            {currentTarget.dataType === 'bool' 
              ? "This is a Boolean root schema. There are no additional rules to configure." 
              : "This is a primitive root schema. Click below to configure its validation rules."}
          </Text>
          {currentTarget.dataType !== 'bool' && (
            <Button 
              leftSection={<TbSettings size={16} />} 
              color="violet" 
              variant="light"
              onClick={() => openDrawer(path)}
            >
              Configure Rules
            </Button>
          )}
        </Stack>
      )}
    </Box>
  );
};

export default SchemaSlide;
