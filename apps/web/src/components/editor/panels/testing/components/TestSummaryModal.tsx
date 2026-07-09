import React, { useState } from "react";
import { Modal, Text, List, ThemeIcon, Button, Group, Badge, Box, Paper, Stack, ActionIcon, Tabs } from "@mantine/core";
import { TbAlertCircle, TbX, TbCheck, TbFileUnknown, TbChevronRight, TbArrowLeft } from "react-icons/tb";

interface TestSummaryModalProps {
  opened: boolean;
  onClose: () => void;
  suites: { 
    name?: string; 
    success?: boolean;
    errors?: string[]; 
    assertions?: { success: boolean, message: string }[];
    actualData?: unknown;
  }[];
}

export default function TestSummaryModal({
  opened,
  onClose,
  suites,
}: TestSummaryModalProps) {
  const [selectedSuiteIndex, setSelectedSuiteIndex] = useState<number | null>(null);

  const handleClose = () => {
    setSelectedSuiteIndex(null);
    onClose();
  };

  const allPassed = suites.length > 0 && suites.every(s => s.success);
  const totalFailed = suites.filter(s => !s.success).length;

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      size="xl"
      padding="xl"
      withCloseButton={false}
      radius="md"
      overlayProps={{
        backgroundOpacity: 0.55,
        blur: 3,
      }}
    >
      <Group justify="space-between" mb="lg" align="flex-start">
        <Group gap="md">
          <ThemeIcon size={48} radius="md" color={allPassed ? "green.1" : "red.1"} c={allPassed ? "green.6" : "red.6"}>
            {allPassed ? <TbCheck size={28} /> : <TbAlertCircle size={28} />}
          </ThemeIcon>
          <Box>
            <Text fw={700} size="xl" c="gray.9">
              Test Execution Summary
            </Text>
            <Text size="sm" c="gray.6" mt={2}>
              {allPassed 
                ? `All ${suites.length} test suite${suites.length !== 1 ? 's' : ''} passed successfully.` 
                : `${totalFailed} out of ${suites.length} test suite${suites.length !== 1 ? 's' : ''} encountered errors.`}
            </Text>
          </Box>
        </Group>
      </Group>

      <Box bg="gray.0" p="md" style={{ borderRadius: 8, border: '1px solid #eee', overflow: 'hidden' }} mb="xl">
        <Box
          style={{
            display: "flex",
            width: "200%",
            transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
            transform: selectedSuiteIndex !== null ? "translateX(-50%)" : "translateX(0)",
            alignItems: "flex-start",
          }}
        >
          {/* Master View: List of suites */}
          <Box style={{ width: "50%", paddingRight: selectedSuiteIndex !== null ? 20 : 0, transition: 'padding 0.3s' }}>
            <Stack gap="sm">
              {suites.map((suite, i) => (
                <Paper
                  key={i}
                  withBorder
                  p="md"
                  radius="md"
                  style={{ 
                    cursor: "pointer", 
                    borderColor: suite.success ? '#d1fae5' : '#fecaca', 
                    backgroundColor: 'white',
                    transition: 'background-color 0.2s ease, transform 0.1s ease',
                  }}
                  onClick={() => setSelectedSuiteIndex(i)}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = suite.success ? '#f0fdf4' : '#fff5f5')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'white')}
                >
                  <Group justify="space-between" wrap="nowrap">
                    <Text fw={600} size="sm" c="gray.9">
                      {suite.name || "Unknown Suite"}
                    </Text>
                    <Group gap="xs">
                      {suite.success ? (
                        <Badge color="green" variant="light" size="sm" radius="sm">
                          Passed
                        </Badge>
                      ) : (
                        <Badge color="red" variant="light" size="sm" radius="sm">
                          {suite.errors?.length || 0} Error{(suite.errors?.length || 0) !== 1 ? 's' : ''}
                        </Badge>
                      )}
                      <TbChevronRight size={18} color="#adb5bd" />
                    </Group>
                  </Group>
                </Paper>
              ))}
            </Stack>
          </Box>

          {/* Detail View: Assertions and Data for selected suite */}
          <Box style={{ width: "50%", paddingLeft: selectedSuiteIndex !== null ? 0 : 20, transition: 'padding 0.3s' }}>
            {selectedSuiteIndex !== null && (
              <Box>
                <Group mb="md" gap="xs">
                  <ActionIcon variant="subtle" color="gray" onClick={() => setSelectedSuiteIndex(null)}>
                    <TbArrowLeft size={18} />
                  </ActionIcon>
                  <Text size="sm" fw={600} c="gray.6" style={{ cursor: 'pointer' }} onClick={() => setSelectedSuiteIndex(null)}>
                    All Suites
                  </Text>
                  <Text size="sm" c="gray.4">/</Text>
                  <Text size="sm" fw={700} c="gray.9">
                    {suites[selectedSuiteIndex].name || "Unknown Suite"}
                  </Text>
                </Group>
                <Paper withBorder p="md" radius="md" bg="white" style={{ borderColor: suites[selectedSuiteIndex].success ? '#d1fae5' : '#fecaca' }}>
                  <Tabs defaultValue="assertions" color={suites[selectedSuiteIndex].success ? "green" : "red"}>
                    <Tabs.List mb="md">
                      <Tabs.Tab value="assertions">Assertions</Tabs.Tab>
                      <Tabs.Tab value="data">Response Data</Tabs.Tab>
                    </Tabs.List>
                    
                    <Tabs.Panel value="assertions">
                      <List
                        spacing="sm"
                        size="sm"
                        center
                      >
                        {(suites[selectedSuiteIndex].assertions || []).map((ast, idx) => (
                          <List.Item 
                            key={idx}
                            icon={
                              <ThemeIcon color={ast.success ? "green.1" : "red.1"} c={ast.success ? "green.6" : "red.6"} size={24} radius="xl">
                                {ast.success ? <TbCheck size={14} /> : <TbX size={14} />}
                              </ThemeIcon>
                            }
                          >
                            <Text size="sm" c="gray.8" style={{ wordBreak: 'break-word' }}>
                              {ast.message}
                            </Text>
                          </List.Item>
                        ))}
                        {(!suites[selectedSuiteIndex].assertions || suites[selectedSuiteIndex].assertions!.length === 0) && (
                          <List.Item
                            icon={
                              <ThemeIcon color="gray.1" c="gray.6" size={24} radius="xl">
                                <TbFileUnknown size={14} />
                              </ThemeIcon>
                            }
                          >
                            <Text size="sm" c="gray.6" fs="italic">
                              No detailed assertions provided or evaluated.
                            </Text>
                          </List.Item>
                        )}
                      </List>
                    </Tabs.Panel>
                    
                    <Tabs.Panel value="data">
                      <Box bg="gray.0" p="xs" style={{ borderRadius: 4, maxHeight: 300, overflow: 'auto' }}>
                        <pre style={{ margin: 0, fontSize: 12, color: '#343a40' }}>
                          {JSON.stringify(suites[selectedSuiteIndex].actualData, null, 2)}
                        </pre>
                      </Box>
                    </Tabs.Panel>
                  </Tabs>
                </Paper>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      <Group justify="flex-end">
        <Button onClick={handleClose} color="gray" variant="light" size="md" radius="md">
          Dismiss
        </Button>
      </Group>
    </Modal>
  );
}
