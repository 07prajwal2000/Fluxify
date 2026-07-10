import { BlockCanvasContext } from "@/context/blockCanvas";
import {
  ActionIcon,
  Box,
  Center,
  Group,
  Menu,
  Paper,
  Stack,
  Text,
  Tooltip,
  useMantineTheme,
} from "@mantine/core";
import { NodeProps } from "@xyflow/react";
import React, { useContext } from "react";
import { TbDots, TbTrash, TbTrashFilled } from "react-icons/tb";
import BlockOptionsMenu from "./blockOptionsMenu";

type OptionsTooltipType = "delete" | "options";

type PropTypes = {
  tooltip: string;
  blockName: string;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  blockId: string;
  nodeProps?: NodeProps;
  topLeftRounded?: boolean;
  topRightRounded?: boolean;
  bottomLeftRounded?: boolean;
  bottomRightRounded?: boolean;
  showOptionsTooltip?: boolean;
  optionsTooltip?: OptionsTooltipType[];
  labelPlacement?: "top" | "bottom" | "left" | "right";
  optionsPlacement?: "top" | "bottom" | "left" | "right";
  color?: string;
  selectedColor?: string;
};

const BaseBlock = (props: PropTypes) => {
  const { nodeProps } = props;
  const gray = useMantineTheme().colors.gray;
  const borderRaduis = "4px";
  const roundedRadius = "20px";
  const labelPlacement = props.labelPlacement || "top";

  function getLabelPlacementStyles() {
    switch (labelPlacement) {
      case "top":
        return { top: "-12px", left: "50%", transform: "translateX(-50%)" };
      case "bottom":
        return { bottom: "-12px", left: "50%", transform: "translateX(-50%)" };
      case "left":
        return { left: "-100%", top: "50%", transform: "translateY(-50%)" };
      case "right":
        return { right: "-100%", top: "50%", transform: "translateY(-50%)" };
      default:
        return { top: "-10px", left: "50%", transform: "translateX(-50%)" };
    }
  }

  return (
    <Menu openDelay={250} position={props.optionsPlacement || labelPlacement} trigger="hover">
      <Menu.Target>
        <Paper
          p={"sm"}
          c={"dark"}
          style={{
            outline: nodeProps?.selected ? `3px solid ${gray[2]}` : "none",
            backgroundColor: nodeProps?.selected ? (props.selectedColor || gray[0]) : (props.color || "white"),
            cursor: "pointer",
            borderTopLeftRadius: props.topLeftRounded
              ? roundedRadius
              : borderRaduis,
            borderTopRightRadius: props.topRightRounded
              ? roundedRadius
              : borderRaduis,
            borderBottomLeftRadius: props.bottomLeftRounded
              ? roundedRadius
              : borderRaduis,
            borderBottomRightRadius: props.bottomRightRounded
              ? roundedRadius
              : borderRaduis,
            position: "relative",
          }}
          withBorder
        >
          <Stack gap={8}>
            <Center pos="relative">{props.icon}</Center>
            {props.children}
          </Stack>
          <Text
            style={{
              textOverflow: "ellipsis",
              overflow: "hidden",
              textAlign: "center",
              position: "absolute",
              width: "100%",
              zIndex: 1,
              ...getLabelPlacementStyles(),
            }}
            size="6px"
            fw={500}
          >
            {props.blockName}
          </Text>
        </Paper>
      </Menu.Target>
      <Menu.Dropdown hidden={props.showOptionsTooltip !== true}>
        <OptionsTooltip
          allowedOptions={props.optionsTooltip ?? ["options"]}
          id={props.blockId}
        />
      </Menu.Dropdown>
    </Menu>
  );
};

function OptionsTooltip(props: {
  id: string;
  allowedOptions: OptionsTooltipType[];
}) {
  const canvasContext = useContext(BlockCanvasContext);
  function onDeleteClick() {
    canvasContext.deleteBlock(props.id);
  }
  return (
    <Box>
      <Group align="center" justify="center">
        {props.allowedOptions.includes("delete") && (
          <ActionIcon
            onClick={onDeleteClick}
            color="dark"
            variant="transparent"
            size="xs"
            fw={500}
          >
            <TbTrashFilled size={15} />
          </ActionIcon>
        )}
        {props.allowedOptions.includes("options") && (
          <BlockOptionsMenu
            blockId={props.id}
            showDelete={props.allowedOptions.includes("delete")}
          />
        )}
      </Group>
    </Box>
  );
}

export default BaseBlock;
