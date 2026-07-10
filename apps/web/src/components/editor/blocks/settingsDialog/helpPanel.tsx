import { BlockCanvasContext } from "@/context/blockCanvas";
import {
  ActionIcon,
  Center,
  CopyButton,
  Stack,
  TextInput,
  Tooltip,
} from "@mantine/core";
import React, { useContext } from "react";
import { StickyNoteHelpPanel } from "../builtin/stickyNote";
import { BlockTypes } from "@/types/block";
import { getHumanReadableBlockName } from "@/lib/blockFactory";
import { ResponseBlockHelpPanel } from "../response";
import { ArrayOperationsHelpPanel } from "../builtin/arrayOperations";
import { ForeachLoopHelpPanel } from "../builtin/foreachLoop";
import DebouncedTextInput from "@/components/editors/debouncedTextInput";
import DebouncedTextArea from "@/components/editors/debouncedTextArea";
import { ForloopHelpPanel } from "../builtin/forloop";
import { GetVarHelpPanel } from "../builtin/getVar";
import { IfConditionHelpPanel } from "../builtin/if";
import { JsRunnerHelpPanel } from "../builtin/jsRunner";
import { NativeBlockHelpPanel } from "../builtin/database/native";
import { blockIcons } from "../searchList";
import { TbCheck, TbCopy } from "react-icons/tb";
import { customBlocksQueries } from "@/query/customBlocksQuery";
import { useFlowEditorContext } from "../../flowEditor/flowEditorContext";
import { getCustomBlockIcon } from "../customBlockNode";

type Props = {
  blockId: string;
  blockData: any;
  collapsed?: boolean;
  blockType: BlockTypes;
};

const HelpPanel = (props: Props) => {
  if (props.collapsed) return <></>;
  const { updateBlockData } = useContext(BlockCanvasContext);
  const { projectId } = useFlowEditorContext();
  const { data: customBlocks } = customBlocksQueries.getAll.useQuery({
    projectId: projectId!,
  });

  const data = props.blockData;
  const blockType = props.blockType;

  const customBlock = customBlocks?.find((cb) => cb.name === blockType);
  const blockName = customBlock
    ? customBlock.label || customBlock.name
    : getHumanReadableBlockName(blockType);
  const icon = customBlock
    ? getCustomBlockIcon(
        customBlock.icon || undefined,
        customBlock.iconUrl || undefined,
        20
      )
    : blockIcons[blockType];

  function onBlockNameChange(value: string) {
    updateBlockData(props.blockId, { blockName: value });
  }

  function onBlockDescriptionChange(value: string) {
    updateBlockData(props.blockId, { blockDescription: value });
  }

  return (
    <Stack gap={"4"}>
      <TextInput
        placeholder="Block ID"
        label="Block ID"
        spellCheck={false}
        readOnly
        value={props.blockId}
        rightSection={
          <CopyButton value={props.blockId} timeout={2000}>
            {({ copied, copy }) => (
              <Tooltip
                label={copied ? "Copied" : "Copy"}
                withArrow
                position="right"
              >
                <ActionIcon
                  color={copied ? "teal" : "gray"}
                  variant="subtle"
                  onClick={copy}
                >
                  {copied ? <TbCheck size={16} /> : <TbCopy size={16} />}
                </ActionIcon>
              </Tooltip>
            )}
          </CopyButton>
        }
      />
      <TextInput
        leftSection={<Center c={"dark.5"}>{icon as any}</Center>}
        placeholder="Block Type"
        label="Block Type"
        spellCheck={false}
        readOnly
        value={blockName}
      />
      <DebouncedTextInput
        placeholder="Block Name"
        label="Block Name"
        spellCheck={false}
        value={data.blockName || ""}
        debounceDelay={450}
        onValueChange={(value) => onBlockNameChange(value)}
      />
      <DebouncedTextArea
        placeholder="Block Description"
        label="Block Description"
        value={data.blockDescription || ""}
        rows={4}
        debounceDelay={250}
        onValueChange={(value) => onBlockDescriptionChange(value)}
      />
      {blockType === BlockTypes.stickynote && (
        <StickyNoteHelpPanel blockId={props.blockId} blockData={data} />
      )}
      {blockType === BlockTypes.response && (
        <ResponseBlockHelpPanel blockId={props.blockId} blockData={data} />
      )}
      {blockType === BlockTypes.arrayops && (
        <ArrayOperationsHelpPanel blockId={props.blockId} blockData={data} />
      )}
      {blockType === BlockTypes.foreachloop && (
        <ForeachLoopHelpPanel blockId={props.blockId} blockData={data} />
      )}
      {blockType === BlockTypes.forloop && (
        <ForloopHelpPanel blockId={props.blockId} blockData={data} />
      )}
      {blockType === BlockTypes.getvar && (
        <GetVarHelpPanel blockId={props.blockId} blockData={data} />
      )}
      {blockType === BlockTypes.if && (
        <IfConditionHelpPanel blockId={props.blockId} blockData={data} />
      )}
      {blockType === BlockTypes.jsrunner && (
        <JsRunnerHelpPanel blockId={props.blockId} blockData={data} />
      )}
      {blockType === BlockTypes.db_native && (
        <NativeBlockHelpPanel blockId={props.blockId} blockData={data} />
      )}
    </Stack>
  );
};

export default HelpPanel;
