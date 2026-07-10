import { BlockCanvasContext } from "@/context/blockCanvas";
import { useEditorActionsStore } from "@/store/editor";
import { Button, ButtonGroup, Tooltip } from "@mantine/core";
import React, { useContext } from "react";
import { TbRotateClockwise } from "react-icons/tb";

const UndoPanel = () => {
  const { undoStack, redoStack } = useEditorActionsStore();
  const disableUndo = undoStack.length === 0;
  const disableRedo = redoStack.length === 0;
  const { redo, undo } = useContext(BlockCanvasContext);
  return (
    <ButtonGroup>
      <Tooltip label={"Undo"} withArrow arrowSize={8} bg={"dark"}>
        <Button
          variant="outline"
          color="violet"
          disabled={disableUndo}
          bg={"white"}
          onClick={undo}
          size="sm"
        >
          <TbRotateClockwise
            style={{ transform: "rotate(180deg) scaleX(-1)" }}
            size={18}
          />
        </Button>
      </Tooltip>
      <Tooltip label={"Redo"} withArrow arrowSize={8} bg={"dark"}>
        <Button
          onClick={redo}
          variant="outline"
          color="violet"
          disabled={disableRedo}
          bg={"white"}
          size="sm"
        >
          <TbRotateClockwise
            style={{ transform: "rotate(180deg)" }}
            size={18}
          />
        </Button>
      </Tooltip>
    </ButtonGroup>
  );
};

export default UndoPanel;
