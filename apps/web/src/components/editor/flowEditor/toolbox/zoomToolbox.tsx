import { ActionIcon, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { useReactFlow, useViewport } from "@xyflow/react";
import React from "react";
import { TbMinus, TbPlus, TbZoom } from "react-icons/tb";

const ZoomToolbox = () => {
  const { zoomIn, zoomOut, zoomTo } = useReactFlow();
  const { zoom } = useViewport();
  function resetZoom() {
    zoomTo(2);
  }
  return (
    <Paper withBorder shadow="sm">
      <Group gap={0}>
        <Tooltip label={"Zoom In"} withArrow arrowSize={8} bg={"dark"}>
          <ActionIcon
            size={"lg"}
            onClick={() => zoomIn()}
            variant="subtle"
            color="dark"
          >
            <TbPlus />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={"Reset Zoom"} withArrow arrowSize={8} bg={"dark"}>
          <ActionIcon
            onClick={resetZoom}
            color="dark"
            size={"xl"}
            variant="transparent"
          >
            <Stack gap={0} align="center">
              <TbZoom />
              <Text size={"xs"}>{Math.round(zoom * 125)}%</Text>
            </Stack>
          </ActionIcon>
        </Tooltip>
        <Tooltip label={"Zoom In"} withArrow arrowSize={8} bg={"dark"}>
          <ActionIcon
            onClick={() => zoomOut()}
            variant="subtle"
            size={"lg"}
            color="dark"
          >
            <TbMinus />
          </ActionIcon>
        </Tooltip>
      </Group>
    </Paper>
  );
};

export default ZoomToolbox;
