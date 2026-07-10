import { useEditorSearchbarStore } from "@/store/editor";
import { ActionIcon, Text, Tooltip } from "@mantine/core";
import React from "react";
import { TbPlus } from "react-icons/tb";

const AddNewBlockButton = () => {
  const { open } = useEditorSearchbarStore();

  return (
    <Tooltip
      position="left"
      withArrow
      arrowSize={8}
      bg={"dark"}
      label={<Text size={"xs"}>Add New Block</Text>}
    >
      <ActionIcon
        bg={"white"}
        id="add-new-block"
        onClick={open}
        size={"lg"}
        color="violet"
        variant="outline"
      >
        <TbPlus size={18} />
      </ActionIcon>
    </Tooltip>
  );
};

export default AddNewBlockButton;
