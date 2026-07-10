import { Tooltip, ActionIcon, Text } from "@mantine/core";
import React, { useContext } from "react";
import { TbNote } from "react-icons/tb";
import { BlockCanvasContext } from "@/context/blockCanvas";
import { BlockTypes } from "@/types/block";

const AddStickyNoteButton = () => {
  const { addBlock } = useContext(BlockCanvasContext);
  const onClick = () => {
    addBlock(BlockTypes.stickynote);
  };
  return (
    <Tooltip
      position="left"
      withArrow
      arrowSize={8}
      bg={"dark"}
      label={<Text size={"xs"}>Add Sticky Note</Text>}
    >
      <ActionIcon
        onClick={onClick}
        bg={"white"}
        size={"lg"}
        color="violet"
        variant="outline"
      >
        <TbNote size={20} />
      </ActionIcon>
    </Tooltip>
  );
};

export default AddStickyNoteButton;
