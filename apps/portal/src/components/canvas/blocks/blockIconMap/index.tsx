import type { ReactNode } from "react";
import { FaHeading, FaMapSigns } from "react-icons/fa";
import { FaArrowRightFromBracket, FaArrowRightToBracket } from "react-icons/fa6";
import { IoLogoJavascript } from "react-icons/io";
import { LuDatabaseZap } from "react-icons/lu";
import { MdDataObject, MdHttp, MdOutlineReportGmailerrorred } from "react-icons/md";
import {
	TbArrowsSplit2,
	TbBox,
	TbCloud,
	TbCodeVariablePlus,
	TbCookie,
	TbDatabaseEdit,
	TbDatabaseExclamation,
	TbDatabaseImport,
	TbDatabasePlus,
	TbDatabaseSearch,
	TbDatabaseX,
	TbInfinity,
	TbKey,
	TbMatrix,
	TbNote,
	TbPlugConnected,
	TbRocket,
	TbSwitch3,
	TbTerminal2,
	TbTransform,
} from "react-icons/tb";
import { VscSymbolParameter } from "react-icons/vsc";
import { BLOCK_TYPES, type BlockType } from "../blockTypes";

const SIZE = 18;

/** Icon per block type. Add a block type → add its icon here. */
export const BLOCK_ICON_MAP: Record<BlockType, ReactNode> = {
	[BLOCK_TYPES.entrypoint]: <FaArrowRightToBracket size={SIZE} />,
	[BLOCK_TYPES.response]: <FaArrowRightFromBracket size={SIZE} />,
	[BLOCK_TYPES.errorHandler]: <MdOutlineReportGmailerrorred size={SIZE} />,
	[BLOCK_TYPES.stickynote]: <TbNote size={SIZE} />,
	[BLOCK_TYPES.if]: <FaMapSigns size={SIZE} />,
	[BLOCK_TYPES.forloop]: <TbInfinity size={SIZE} />,
	[BLOCK_TYPES.foreachloop]: <TbInfinity size={SIZE} />,
	[BLOCK_TYPES.orchestrator]: <TbArrowsSplit2 size={SIZE} />,
	[BLOCK_TYPES.switch]: <TbSwitch3 size={SIZE} />,
	[BLOCK_TYPES.transformer]: <TbTransform size={SIZE} />,
	[BLOCK_TYPES.jsrunner]: <IoLogoJavascript size={SIZE} />,
	[BLOCK_TYPES.setvar]: <TbCodeVariablePlus size={SIZE} />,
	[BLOCK_TYPES.getvar]: <TbCodeVariablePlus size={SIZE} />,
	[BLOCK_TYPES.arrayops]: <TbMatrix size={SIZE} />,
	[BLOCK_TYPES.httprequest]: <MdHttp size={SIZE} />,
	[BLOCK_TYPES.httpgetheader]: <FaHeading size={SIZE} />,
	[BLOCK_TYPES.httpsetheader]: <FaHeading size={SIZE} />,
	[BLOCK_TYPES.httpgetparam]: <VscSymbolParameter size={SIZE} />,
	[BLOCK_TYPES.httpgetcookie]: <TbCookie size={SIZE} />,
	[BLOCK_TYPES.httpsetcookie]: <TbCookie size={SIZE} />,
	[BLOCK_TYPES.httpgetrequestbody]: <MdDataObject size={SIZE} />,
	[BLOCK_TYPES.db_getsingle]: <TbDatabaseSearch size={SIZE} />,
	[BLOCK_TYPES.db_exists]: <TbDatabaseExclamation size={SIZE} />,
	[BLOCK_TYPES.db_getall]: <TbDatabaseSearch size={SIZE} />,
	[BLOCK_TYPES.db_insert]: <TbDatabasePlus size={SIZE} />,
	[BLOCK_TYPES.db_insertbulk]: <TbDatabasePlus size={SIZE} />,
	[BLOCK_TYPES.db_update]: <TbDatabaseImport size={SIZE} />,
	[BLOCK_TYPES.db_delete]: <TbDatabaseX size={SIZE} />,
	[BLOCK_TYPES.db_native]: <TbDatabaseEdit size={SIZE} />,
	[BLOCK_TYPES.db_transaction]: <LuDatabaseZap size={SIZE} />,
	[BLOCK_TYPES.kv_operations]: <TbKey size={SIZE} />,
	[BLOCK_TYPES.kv_raw]: <TbPlugConnected size={SIZE} />,
	[BLOCK_TYPES.consolelog]: <TbTerminal2 size={SIZE} />,
	[BLOCK_TYPES.cloudLogs]: <TbCloud size={SIZE} />,
	[BLOCK_TYPES.triggerWorkflow]: <TbRocket size={SIZE} />,
};

/** Shown for unknown / custom block types. */
export const FALLBACK_BLOCK_ICON: ReactNode = <TbBox size={SIZE} />;

export function blockIcon(type: string): ReactNode {
	return BLOCK_ICON_MAP[type as BlockType] ?? FALLBACK_BLOCK_ICON;
}
