import type { NodeProps, NodeTypes } from "@xyflow/react";
import { BaseBlock } from "./BaseBlock";
import { blockCatalogEntries } from "./blockCatalog";
import { blockIcon } from "./blockIconMap";
import { blockLabels } from "./blockLabels";
import { BLOCK_TYPES } from "./blockTypes";
import { BlockHandle } from "./handles/BlockHandle";
import { StickyNoteBlock } from "./StickyNoteBlock";

function status(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
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
	const { name, description, definition } = blockLabels(type, data);

	return (
		<BaseBlock
			blockId={id}
			blockType={type}
			position={{ x: positionAbsoluteX, y: positionAbsoluteY }}
			name={name}
			description={description}
			icon={blockIcon(type)}
			color={definition.tint}
			selected={selected}
			status={status(data?.status)}
		>
			{definition.handles.map((kind) => (
				<BlockHandle key={kind} blockId={id} kind={kind} />
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
