import { ActionIcon, Box, Grid, Modal } from "@mantine/core";
import React from "react";
import { useEditorBlockSettingsStore } from "@/store/editor";
import BlockDataSettingsPanel from "./blockDataSettingsPanel";
import HelpPanel from "./helpPanel";
import { TbChevronsLeft, TbChevronsRight } from "react-icons/tb";
import {
  useBlockDataStore,
} from "@/store/blockDataStore";
import { useNodesData } from "@xyflow/react";
import { BlockTypes } from "@/types/block";

export type DataSettingsProps<T> = {
  blockId: string;
  blockData: T;
};

const BlockSettingsDialog = () => {
  const blockSettings = useEditorBlockSettingsStore();
  const blockDataStore = useBlockDataStore();
  const selectedBlockDetails = useNodesData(blockSettings.blockId);
  const nodesData = blockDataStore[blockSettings.blockId];
  const [collapsed, setCollapsed] = React.useState(false);

  function toggleCollapsed() {
    setCollapsed(!collapsed);
  }

  return (
    <Modal
      size="70%"
      withCloseButton={false}
      opened={blockSettings.opened}
      onClose={() => blockSettings.close()}
    >
      <Box h={"80vh"}>
        {nodesData && selectedBlockDetails && (
          <Grid h={"80vh"}>
            <Grid.Col
              h={"80vh"}
              style={{ overflowY: "auto" }}
              span={collapsed ? 1 : 3}
              pos="relative"
            >
              <HelpPanel
                blockId={blockSettings.blockId}
                blockData={nodesData}
                collapsed={collapsed}
                blockType={selectedBlockDetails.type as BlockTypes}
              />
              <ActionIcon
                size={"md"}
                pos={"absolute"}
                variant="outline"
                color="violet"
                right={collapsed ? "50%" : "0"}
                top={"0"}
                style={{
                  transform: ` ${
                    collapsed ? "translateX(50%)" : "translateX(0)"
                  }`,
                }}
                onClick={toggleCollapsed}
              >
                {collapsed ? <TbChevronsRight /> : <TbChevronsLeft />}
              </ActionIcon>
            </Grid.Col>
            <Grid.Col
              h={"80vh"}
              style={{ overflowY: "auto" }}
              span={collapsed ? 11 : 9}
            >
              <BlockDataSettingsPanel
                blockData={{
                  data: nodesData,
                  id: blockSettings.blockId,
                  type: selectedBlockDetails.type as BlockTypes,
                }}
              />
            </Grid.Col>
          </Grid>
        )}
      </Box>
    </Modal>
  );
};

export default BlockSettingsDialog;
