import {
  ActionIcon,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import React from "react";
import { TbCpu } from "react-icons/tb";

const AiButton = () => {
  return (
    <Tooltip
      position="left"
      withArrow
      arrowSize={8}
      label={<Text size={"xs"}>AI — Coming Soon</Text>}
    >
      <ActionIcon
        px={"sm"}
        size={48}
        color="violet"
        variant="outline"
        bg={"white"}
        disabled
      >
        <Stack gap={0} justify="center" align="center">
          <TbCpu size={25} />
          <Text size={"12px"}>AI</Text>
        </Stack>
      </ActionIcon>
    </Tooltip>
  );
};

export default AiButton;
