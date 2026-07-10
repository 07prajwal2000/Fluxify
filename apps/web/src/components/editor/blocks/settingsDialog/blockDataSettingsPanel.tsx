import { Center } from "@mantine/core";
import React from "react";
import { BlockTypes } from "@/types/block";
import { StickyNoteSettingsPanel } from "../builtin/stickyNote";
import { ResponseBlockDataSettingsPanel } from "../response";
import { ArrayOperationsSettingsPanel } from "../builtin/arrayOperations";
import { ForeachLoopSettingsPanel } from "../builtin/foreachLoop";
import { ForloopSettingsPanel } from "../builtin/forloop";
import { GetVarSettingsPanel } from "../builtin/getVar";
import { SetVarSettingsPanel } from "../builtin/setVar";
import { IfConditionSettingsPanel } from "../builtin/if";
import { TransformerBlockDataSettingsPanel } from "../builtin/transformer";
import { JsRunnerSettingsPanel } from "../builtin/jsRunner";
import { ConsoleSettingsPanel } from "../builtin/logging/console";
import { GetCookieSettingsPanel } from "../builtin/http/getCookie";
import { GetHeaderSettingsPanel } from "../builtin/http/getHeader";
import { GetParamSettingsPanel } from "../builtin/http/getParam";
import { SetHeaderSettingsPanel } from "../builtin/http/setHeader";
import { HttpRequestSettingsPanel } from "../builtin/httpRequest";
import { SetCookieSettingsPanel } from "../builtin/http/setCookie";
import { GetSingleFromDBSettingsPanel } from "../builtin/database/getSingle";
import { InsertBulkSettingsPanel } from "../builtin/database/insertBulk";
import { InsertBlockSettingsPanel } from "../builtin/database/insert";
import { UpdateBlockDataSettingsPanel } from "../builtin/database/update";
import { GetAllBlockDataSettingsPanel } from "../builtin/database/getAll";
import { DeleteBlockDataSettingsPanel } from "../builtin/database/delete";
import { TransactionBlockDataSettingsPanel } from "../builtin/database/transaction";
import { NativeBlockDataSettingsPanel } from "../builtin/database/native";
import { CloudSettingsPanel } from "../builtin/logging/cloud";
import { CustomBlockSettingsPanel } from "./customBlockSettingsPanel";
import { customBlocksQueries } from "@/query/customBlocksQuery";
import { useFlowEditorContext } from "../../flowEditor/flowEditorContext";

type Props = {
  blockData: {
    id: string;
    data: any;
    type: BlockTypes;
  };
};

const BlockDataSettingsPanel = (props: Props) => {
  const blockData = props.blockData.data;
  const blockId = props.blockData.id;
  const { projectId } = useFlowEditorContext();
  const { data: customBlocks } = customBlocksQueries.getAll.useQuery({
    projectId: projectId!,
  });

  switch (props.blockData.type) {
    case BlockTypes.stickynote:
      return (
        <StickyNoteSettingsPanel blockId={blockId} blockData={blockData} />
      );
    case BlockTypes.response:
      return (
        <ResponseBlockDataSettingsPanel
          blockData={blockData}
          blockId={blockId}
        />
      );
    case BlockTypes.arrayops:
      return (
        <ArrayOperationsSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.foreachloop:
      return (
        <ForeachLoopSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.forloop:
      return <ForloopSettingsPanel blockData={blockData} blockId={blockId} />;
    case BlockTypes.getvar:
      return <GetVarSettingsPanel blockData={blockData} blockId={blockId} />;
    case BlockTypes.setvar:
      return <SetVarSettingsPanel blockData={blockData} blockId={blockId} />;
    case BlockTypes.if:
      return (
        <IfConditionSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.transformer:
      return (
        <TransformerBlockDataSettingsPanel
          blockData={blockData}
          blockId={blockId}
        />
      );
    case BlockTypes.jsrunner:
      return <JsRunnerSettingsPanel blockData={blockData} blockId={blockId} />;
    case BlockTypes.consolelog:
      return <ConsoleSettingsPanel blockData={blockData} blockId={blockId} />;
    case BlockTypes.httpgetcookie:
      return <GetCookieSettingsPanel blockData={blockData} blockId={blockId} />;
    case BlockTypes.httpgetheader:
      return <GetHeaderSettingsPanel blockData={blockData} blockId={blockId} />;
    case BlockTypes.httpgetparam:
      return <GetParamSettingsPanel blockData={blockData} blockId={blockId} />;
    case BlockTypes.httpsetheader:
      return <SetHeaderSettingsPanel blockData={blockData} blockId={blockId} />;
    case BlockTypes.httprequest:
      return (
        <HttpRequestSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.httpsetcookie:
      return <SetCookieSettingsPanel blockData={blockData} blockId={blockId} />;
    case BlockTypes.db_getsingle:
      return (
        <GetSingleFromDBSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.db_insertbulk:
      return (
        <InsertBulkSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.db_insert:
      return (
        <InsertBlockSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.db_update:
      return (
        <UpdateBlockDataSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.db_getall:
      return (
        <GetAllBlockDataSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.db_delete:
      return (
        <DeleteBlockDataSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.db_transaction:
      return (
        <TransactionBlockDataSettingsPanel
          blockData={blockData}
          blockId={blockId}
        />
      );
    case BlockTypes.db_native:
      return (
        <NativeBlockDataSettingsPanel blockData={blockData} blockId={blockId} />
      );
    case BlockTypes.cloudLogs:
      return <CloudSettingsPanel blockData={blockData} blockId={blockId} />;
    default:
      const customBlock = customBlocks?.find((cb) => cb.name === props.blockData.type);
      if (customBlock) {
        return (
          <CustomBlockSettingsPanel
            blockId={blockId}
            blockData={blockData}
            customBlock={customBlock}
          />
        );
      }

      return (
        <Center>No Data is available to edit for this type of block</Center>
      );
  }
};

export default BlockDataSettingsPanel;
