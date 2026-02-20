import React from "react";
import { Badge, Paper, TextInput, Group, Box, Text, rem } from "@mantine/core";

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

const methodColors: Record<string, string> = {
  GET: "#228be6", // blue
  POST: "#40c057", // green
  PUT: "#fab005", // orange
  DELETE: "#fa5252", // red
  PATCH: "#be4bdb", // grape
};

interface UrlBarProps {
  method: string;
  path: string;
  rightSection?: React.ReactNode;
}

const UrlBar = ({ method, path, rightSection }: UrlBarProps) => {
  const upperMethod = method.toUpperCase();
  
  return (
    <Paper 
      withBorder 
      px={10} 
      py={rem(5)}
      radius="md" 
      bg="white"
      style={(theme) => ({ 
        border: `1px solid ${theme.colors.gray[2]}`,
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing.md,
        boxShadow: '0 1px 3px rgba(0,0,0,0.05)'
      })}
    >
      <Badge 
        variant="filled" 
        style={{ 
          backgroundColor: methodColors[upperMethod] || "#868e96",
          width: rem(80),
          height: rem(32),
          borderRadius: rem(4)
        }}
        styles={{ label: { fontWeight: 900, fontSize: '11px', letterSpacing: '0.5px' } }}
      >
        {upperMethod}
      </Badge>
      
      <Group gap={6} style={{ flex: 1 }}>
        <Text size="xs" fw={800} c="gray.4" style={{ letterSpacing: '0.5px' }}>HOST</Text>
        <TextInput
          readOnly
          value={path}
          variant="unstyled"
          size="sm"
          style={{ flex: 1 }}
          styles={{ 
            input: { 
              fontWeight: 700, 
              fontSize: rem(14.5), 
              color: '#343A40',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'
            } 
          }}
        />
      </Group>

      {rightSection}
    </Paper>
  );
};

export default UrlBar;
