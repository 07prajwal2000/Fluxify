import type { NodeProps, NodeTypes } from "@xyflow/react";
import { GoWorkflow } from "react-icons/go";
import { IoExtensionPuzzle } from "react-icons/io5";
import { TbFlask, TbWebhook } from "react-icons/tb";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import { useCanvasResourceType } from "../CanvasResourceContext";
import { BaseBlock, type BlockVariant } from "./BaseBlock";
import { BLOCK_CATALOG, blockCatalogEntries } from "./blockCatalog";
import { blockIcon } from "./blockIconMap";
import { blockLabels } from "./blockLabels";
import { BLOCK_TYPES } from "./blockTypes";
import { BlockHandle } from "./handles/BlockHandle";
import type { HandleKind } from "./handles/handleConfig";
import { StickyNoteBlock } from "./StickyNoteBlock";
import { useCustomBlockDefs } from "./useCustomBlockDefs";

function status(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

/** The entrypoint's icon says what starts this flow. */
const ENTRYPOINT_ICON = {
	route: <TbWebhook size={18} />,
	workflow: <GoWorkflow size={18} />,
	custom_block: <IoExtensionPuzzle size={18} />,
	sandbox: <TbFlask size={18} />,
};

/**
 * Card design by sockets: a body handle makes a container; at most one input and
 * one output, or a true/false pair, makes a compact square.
 */
export function blockVariant(type: string, handles: HandleKind[]): BlockVariant {
	if (handles.some((kind) => kind === "executor" || kind === "orchestrate")) return "container";
	if (handles.includes("success") || handles.includes("failure")) {
		const branch = handles.every(
			(kind) => kind === "target" || kind === "success" || kind === "failure",
		);
		return branch ? "compact" : "default";
	}
	const simple = handles.every((kind) => kind === "target" || kind === "source");
	return simple && handles.length > 0 ? "compact" : "default";
}

/**
 * Renders any block type from the catalog: icon + name + description, with the
 * sockets the catalog declares. A block only needs a catalog entry and an icon.
 */
export function BlockNode({
	id,
	type,
	data,
	selected,
	positionAbsoluteX,
	positionAbsoluteY,
}: NodeProps) {
	const { name, description, definition, custom } = blockLabels(type, data);
	// A custom block has no catalog entry: its name, blurb and icon live in the DB.
	// Anything the user typed on this node still wins.
	const customDef = useCustomBlockDefs().find((def) => def.name === type);
	// Custom blocks keep the full card, without the blurb.
	const isCustomBlock = !(type in BLOCK_CATALOG);
	const resourceType = useCanvasResourceType();
	const isRouteOwned = type === BLOCK_TYPES.entrypoint || type === BLOCK_TYPES.errorHandler;

	return (
		<BaseBlock
			variant={isCustomBlock ? "default" : blockVariant(type, definition.handles)}
			blockId={id}
			blockType={type}
			position={{ x: positionAbsoluteX, y: positionAbsoluteY }}
			name={custom ? name : (customDef?.label ?? name)}
			description={
				isCustomBlock
					? undefined
					: description === definition.description
						? (customDef?.description ?? description)
						: description
			}
			icon={
				customDef ? (
					<CustomBlockIcon icon={customDef.icon} iconUrl={customDef.iconUrl} />
				) : type === BLOCK_TYPES.entrypoint ? (
					ENTRYPOINT_ICON[resourceType]
				) : (
					blockIcon(type)
				)
			}
			color={definition.tint}
			selected={selected}
			status={status(data?.status)}
			allowMutatingActions={!isRouteOwned}
		>
			{definition.handles.map((kind) => (
				<BlockHandle key={kind} blockId={id} kind={kind} label={definition.handleLabels?.[kind]} />
			))}
		</BaseBlock>
	);
}

/** `nodeTypes` for React Flow covering every catalog block type and custom block fallback. */
export function createBlockNodeTypes(extra?: NodeTypes): NodeTypes {
	const types: NodeTypes = {};
	for (const [type] of blockCatalogEntries()) types[type] = BlockNode;
	// Notes are markdown + resizable, not the icon/name/description card.
	types[BLOCK_TYPES.stickynote] = StickyNoteBlock;
	Object.assign(types, extra);

	return new Proxy(types, {
		get(target, prop: string) {
			if (prop in target) return target[prop];
			return BlockNode;
		},
	});
}
