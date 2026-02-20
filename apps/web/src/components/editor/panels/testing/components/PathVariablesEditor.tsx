import React from "react";
import { Box, Text, TextInput, Stack, Grid } from "@mantine/core";

interface PathVariablesEditorProps {
  pathParams: Record<string, string>;
  onPathParamsChange: (data: Record<string, string>) => void;
}

const PathVariablesEditor = ({
  pathParams,
  onPathParamsChange,
}: PathVariablesEditorProps) => {
  const keys = Object.keys(pathParams);

  if (keys.length === 0) {
    return (
      <Box p="md" bg="gray.0" style={{ borderRadius: '8px', border: '1px dashed #ced4da' }}>
        <Text size="sm" c="dimmed" ta="center">No path parameters detected in route.</Text>
      </Box>
    );
  }

  return (
    <Box style={(theme) => ({ borderRadius: theme.radius.md, border: `1px solid ${theme.colors.gray[2]}`, overflow: 'hidden' })}>
      <Box bg="gray.0" py={8} px="md" style={(theme) => ({ borderBottom: `1px solid ${theme.colors.gray[2]}` })}>
        <Grid>
          <Grid.Col span={4}>
            <Text size="xs" fw={700} c="gray.6" style={{ textTransform: 'uppercase' }}>Key</Text>
          </Grid.Col>
          <Grid.Col span={8}>
            <Text size="xs" fw={700} c="gray.6" style={{ textTransform: 'uppercase' }}>Value</Text>
          </Grid.Col>
        </Grid>
      </Box>
      <Stack gap={0}>
        {keys.map((key) => (
          <Box key={key} px="md" py={4} style={(theme) => ({ borderBottom: `1px solid ${theme.colors.gray[1]}` })}>
            <Grid align="center">
              <Grid.Col span={4}>
                <Text size="sm" fw={600} c="gray.7" style={{ fontFamily: 'monospace' }}>{key}</Text>
              </Grid.Col>
              <Grid.Col span={8}>
                <TextInput
                  variant="unstyled"
                  placeholder="Value"
                  size="sm"
                  value={pathParams[key]}
                  onChange={(e) => onPathParamsChange({ ...pathParams, [key]: e.currentTarget.value })}
                  styles={{ input: { height: '32px', minHeight: '32px' } }}
                />
              </Grid.Col>
            </Grid>
          </Box>
        ))}
      </Stack>
    </Box>
  );
};

export default PathVariablesEditor;
