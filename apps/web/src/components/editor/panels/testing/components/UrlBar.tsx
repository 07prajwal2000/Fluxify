import React from "react";
import { Paper, TextInput, Group, Box, Text, rem } from "@mantine/core";

const getMethodColor = (method: string) => {
  switch (method?.toUpperCase()) {
    case "GET": return "#059669"; // Emerald-600
    case "POST": return "#D97706"; // Amber-600
    case "PUT": return "#2563EB"; // Blue-600
    case "DELETE": return "#DC2626"; // Red-600
    default: return "#4B5563"; // Gray-600
  }
};

interface UrlBarProps {
  method: string;
  path: string;
  rightSection?: React.ReactNode;
}

const UrlBar = ({ method, path, rightSection }: UrlBarProps) => {
  return (
    <Box 
      style={(theme) => ({
        display: "flex",
        border: "1px solid #D1D5DB",
        borderRadius: theme.radius.md,
        overflow: "hidden",
        backgroundColor: "#F9FAFB",
        alignItems: "center",
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
      })}
    >
      <Box
        px="xl"
        py={10}
        bg="white"
        style={{
          borderRight: "1px solid #D1D5DB",
          color: getMethodColor(method),
          fontWeight: 800,
          fontSize: rem(14),
          minWidth: rem(100),
          textAlign: 'center'
        }}
      >
        {method.toUpperCase()}
      </Box>
      <Box px="md" py={10} style={{ flex: 1 }}>
        <Text 
          size="sm" 
          c="gray.7" 
          fw={600}
          style={{ 
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            wordBreak: "break-all",
          }}
        >
          {path}
        </Text>
      </Box>
      {rightSection && (
        <Box p={4} style={{ borderLeft: "1px solid #D1D5DB", backgroundColor: 'white' }}>
          {rightSection}
        </Box>
      )}
    </Box>
  );
};

export default UrlBar;
