import type { ReactNode } from "react";
import { type NodeProps, Position } from "@xyflow/react";
import { TbWorldCode, TbDoorExit, TbInfinity, TbTransform, TbCodeVariablePlus, TbMatrix, TbCookie, TbDatabaseX, TbDatabaseSearch, TbDatabasePlus, TbDatabaseEdit, TbDatabaseImport, TbTerminal2, TbCloud } from "react-icons/tb";
import { MdOutlineReportGmailerrorred, MdHttp, MdDataObject } from "react-icons/md";
import { FaMapSigns, FaHeading } from "react-icons/fa";
import { IoLogoJavascript } from "react-icons/io";
import { VscSymbolParameter } from "react-icons/vsc";
import { LuDatabaseZap } from "react-icons/lu";
import { BlockTypes } from "@/types/block";
import { BaseBlock } from "./BaseBlock";
import { BlockHandle } from "./BlockHandle";

const GREEN = "#40c057";
const VIOLET = "#7c5cff";
const RED = "#e5484d";

type Label = "top" | "bottom" | "left" | "right";
type HandleCfg = {
	type: "source" | "target";
	position: Position;
	variant?: string;
	color?: string;
};
type Shape = {
	topLeftRounded?: boolean;
	topRightRounded?: boolean;
	bottomLeftRounded?: boolean;
	bottomRightRounded?: boolean;
};

// Standard block: one target on top, one source on bottom.
const STD: HandleCfg[] = [
	{ type: "target", position: Position.Top },
	{ type: "source", position: Position.Bottom },
];

function node(
	name: string,
	icon: ReactNode,
	label: Label,
	handles: HandleCfg[] = STD,
	shape: Shape = {},
) {
	return function Node(props: NodeProps) {
		return (
			<BaseBlock
				blockId={props.id}
				selected={props.selected}
				icon={icon}
				blockName={name}
				labelPlacement={label}
				{...shape}
			>
				{handles.map((h) => (
					<BlockHandle
						key={`${h.type}-${h.variant ?? h.position}`}
						blockId={props.id}
						type={h.type}
						position={h.position}
						handleVariant={h.variant}
						color={h.color}
					/>
				))}
			</BaseBlock>
		);
	};
}

const sz = 18;

export const blocksList: Record<string, (props: NodeProps) => ReactNode> = {
	[BlockTypes.entrypoint]: node("Entrypoint", <TbWorldCode size={sz} />, "top", [{ type: "source", position: Position.Bottom }], { topLeftRounded: true, topRightRounded: true }),
	[BlockTypes.response]: node("Response", <TbDoorExit size={sz} />, "bottom", [{ type: "target", position: Position.Top }], { bottomLeftRounded: true, bottomRightRounded: true }),
	[BlockTypes.errorHandler]: node("Error Handler", <MdOutlineReportGmailerrorred size={sz} color={RED} />, "top", [{ type: "source", position: Position.Bottom, color: RED }]),
	[BlockTypes.if]: node("If", <FaMapSigns size={sz} />, "bottom", [
		{ type: "target", position: Position.Top },
		{ type: "source", position: Position.Left, variant: "success", color: GREEN },
		{ type: "source", position: Position.Right, variant: "failure", color: RED },
	]),
	[BlockTypes.forloop]: node("For", <TbInfinity size={sz} color={GREEN} />, "left", [
		{ type: "target", position: Position.Top },
		{ type: "source", position: Position.Bottom },
		{ type: "source", position: Position.Right, variant: "executor", color: GREEN },
	]),
	[BlockTypes.foreachloop]: node("Foreach", <TbInfinity size={sz} color={VIOLET} />, "left", [
		{ type: "target", position: Position.Top },
		{ type: "source", position: Position.Bottom },
		{ type: "source", position: Position.Right, variant: "executor", color: VIOLET },
	]),
	[BlockTypes.transformer]: node("Transformer", <TbTransform size={sz} />, "left"),
	[BlockTypes.jsrunner]: node("JS Runner", <IoLogoJavascript size={sz} />, "left"),
	[BlockTypes.setvar]: node("Set Variable", <TbCodeVariablePlus size={sz} color={VIOLET} />, "left"),
	[BlockTypes.getvar]: node("Get Variable", <TbCodeVariablePlus size={sz} color={GREEN} />, "left"),
	[BlockTypes.arrayops]: node("Array Operations", <TbMatrix size={sz} />, "left"),
	[BlockTypes.httprequest]: node("Http Request", <MdHttp size={sz} />, "left"),
	[BlockTypes.httpgetcookie]: node("Get Cookie", <TbCookie size={sz} color={GREEN} />, "left"),
	[BlockTypes.httpsetcookie]: node("Set Cookie", <TbCookie size={sz} color={VIOLET} />, "left"),
	[BlockTypes.httpgetheader]: node("Get Header", <FaHeading size={sz} color={GREEN} />, "left"),
	[BlockTypes.httpsetheader]: node("Set Header", <FaHeading size={sz} color={VIOLET} />, "left"),
	[BlockTypes.httpgetparam]: node("Get Param", <VscSymbolParameter size={sz} color={GREEN} />, "left"),
	[BlockTypes.httpgetrequestbody]: node("Get Request Body", <MdDataObject size={sz} color={GREEN} />, "left"),
	[BlockTypes.db_getsingle]: node("Get Single Record", <TbDatabaseSearch size={sz} />, "left"),
	[BlockTypes.db_getall]: node("Get All Records", <TbDatabaseSearch size={sz} />, "left"),
	[BlockTypes.db_insert]: node("Insert New Record", <TbDatabasePlus size={sz} />, "left"),
	[BlockTypes.db_insertbulk]: node("Insert Bulk Record", <TbDatabasePlus size={sz} />, "left"),
	[BlockTypes.db_update]: node("Update Record(s)", <TbDatabaseImport size={sz} />, "left"),
	[BlockTypes.db_delete]: node("Delete Record(s)", <TbDatabaseX size={sz} />, "left"),
	[BlockTypes.db_native]: node("Native Database", <TbDatabaseEdit size={sz} />, "left"),
	[BlockTypes.db_transaction]: node("Database Transaction", <LuDatabaseZap size={sz} />, "left", [
		{ type: "target", position: Position.Top },
		{ type: "source", position: Position.Bottom },
		{ type: "source", position: Position.Right, variant: "executor", color: GREEN },
	]),
	[BlockTypes.consolelog]: node("Console", <TbTerminal2 size={sz} />, "left"),
	[BlockTypes.cloudLogs]: node("Cloud Log store", <TbCloud size={sz} />, "left"),
};
