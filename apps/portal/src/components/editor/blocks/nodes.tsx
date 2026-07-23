import { type NodeProps, Position } from "@xyflow/react";
import { TbWorldCode, TbDoorExit } from "react-icons/tb";
import { MdOutlineReportGmailerrorred } from "react-icons/md";
import { BlockTypes } from "@/types/block";
import { BaseBlock } from "./BaseBlock";
import { BlockHandle } from "./BlockHandle";

function Entrypoint(props: NodeProps) {
	return (
		<BaseBlock
			blockId={props.id}
			selected={props.selected}
			icon={<TbWorldCode size={18} />}
			blockName="Entrypoint"
			labelPlacement="top"
			topLeftRounded
			topRightRounded
		>
			<BlockHandle type="source" blockId={props.id} position={Position.Bottom} />
		</BaseBlock>
	);
}

function Response(props: NodeProps) {
	return (
		<BaseBlock
			blockId={props.id}
			selected={props.selected}
			icon={<TbDoorExit size={18} />}
			blockName="Response"
			labelPlacement="bottom"
			bottomLeftRounded
			bottomRightRounded
		>
			<BlockHandle type="target" blockId={props.id} position={Position.Top} />
		</BaseBlock>
	);
}

function ErrorHandler(props: NodeProps) {
	return (
		<BaseBlock
			blockId={props.id}
			selected={props.selected}
			icon={<MdOutlineReportGmailerrorred size={18} color="#e5484d" />}
			blockName="Error Handler"
			labelPlacement="top"
		>
			<BlockHandle
				type="source"
				blockId={props.id}
				position={Position.Bottom}
				color="#e5484d"
			/>
		</BaseBlock>
	);
}

// Registry of ported node types. Types not listed fall back to the generic
// node in the editor route (still-to-port block types render generically).
export const blocksList: Record<string, (props: NodeProps) => React.ReactNode> = {
	[BlockTypes.entrypoint]: Entrypoint,
	[BlockTypes.response]: Response,
	[BlockTypes.errorHandler]: ErrorHandler,
};
