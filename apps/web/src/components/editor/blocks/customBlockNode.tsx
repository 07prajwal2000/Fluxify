import React, { useMemo } from "react";
import { Box, useMantineTheme } from "@mantine/core";
import BaseBlock from "./base";
import { NodeProps, Position } from "@xyflow/react";
import BlockHandle from "./handle";
import { useFlowEditorContext } from "../flowEditor/flowEditorContext";
import { customBlocksQueries } from "@/query/customBlocksQuery";
import {
  TbCodeVariable,
  TbBrandPython,
  TbBrandJavascript,
  TbDatabase,
  TbCloud,
  TbMail,
  TbMessage,
  TbApi,
  TbWebhook,
  TbLock,
  TbKey,
} from "react-icons/tb";

export const getCustomBlockIcon = (iconType?: string, iconUrl?: string, size = 15) => {
  const premadeIconsMap: Record<string, React.ReactNode> = {
    python: <TbBrandPython size={size} />,
    javascript: <TbBrandJavascript size={size} />,
    database: <TbDatabase size={size} />,
    cloud: <TbCloud size={size} />,
    mail: <TbMail size={size} />,
    message: <TbMessage size={size} />,
    api: <TbApi size={size} />,
    webhook: <TbWebhook size={size} />,
    lock: <TbLock size={size} />,
    key: <TbKey size={size} />,
  };

  if (iconUrl) {
    if (iconType === "premade-list" && premadeIconsMap[iconUrl]) {
      return premadeIconsMap[iconUrl];
    } else if (iconType === "custom") {
      return (
        <img
          src={iconUrl}
          alt="icon"
          style={{ width: size, height: size, objectFit: "contain" }}
        />
      );
    }
  }
  return <TbCodeVariable size={size} />;
};

const CustomBlockNode = (props: NodeProps) => {
  const { projectId } = useFlowEditorContext();
  const { data: customBlocks } = customBlocksQueries.getAll.useQuery({
    projectId: projectId!,
  });

  const blockData = useMemo(() => {
    return customBlocks?.find((cb) => cb.name === props.type);
  }, [customBlocks, props.type]);

  const theme = useMantineTheme();
  const icon = getCustomBlockIcon(blockData?.icon || undefined, blockData?.iconUrl || undefined);
  const color = blockData?.sourceType === "inhouse" ? theme.colors.green[0] : theme.colors.yellow[0];
  const selectedColor = blockData?.sourceType === "inhouse" ? theme.colors.green[1] : theme.colors.yellow[1];

  return (
    <BaseBlock
      blockId={props.id}
      nodeProps={props}
      icon={icon}
      color={color}
      selectedColor={selectedColor}
      tooltip={props?.data?.label?.toString() ?? ""}
      showOptionsTooltip={!props.dragging}
      optionsTooltip={["delete", "options"]}
      blockName={blockData?.label || props.type}
      labelPlacement="right"
      optionsPlacement="left"
    >
      <BlockHandle type="target" blockId={props.id} position={Position.Top} />
      <BlockHandle
        type="source"
        blockId={props.id}
        position={Position.Bottom}
      />
    </BaseBlock>
  );
};

export default CustomBlockNode;
