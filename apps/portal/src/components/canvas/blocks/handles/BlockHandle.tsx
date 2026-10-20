import type { BodyCorner } from "@fluxify/blocks/layout";
import { Handle, Position, useNodeConnections } from "@xyflow/react";
import { TbPlus } from "react-icons/tb";
import { useQuickAdd } from "../../QuickAddContext";
import { HANDLE_CONFIG, type HandleKind, handleId } from "./handleConfig";

export type BlockHandleProps = {
	blockId: string;
	kind: HandleKind;
	/** Overrides the themed colour for this socket. */
	color?: string;
	/** Overrides the tooltip / aria label. */
	label?: string;
	className?: string;
	/** A plugin handle's own name, when it is not one of the kinds: the id is `<blockId>-<name>`. */
	name?: string;
	/** Replaces the kind's connection limit (`null` = unlimited). */
	maxConnections?: number | null;
	/** A plugin body handle's corner: the rail it stacks on, and the edge it leaves from. */
	corner?: BodyCorner;
	/** Why a plugin deprecated this handle. */
	deprecated?: string;
};

/**
 * A single socket. Placement comes from the kind (see HANDLE_CONFIG) — the
 * parent BaseBlock buckets handles onto the correct edge rail, so callers just
 * declare `<BlockHandle kind="success" />` as a child of the block. A plugin
 * handle borrows the look of a kind and names itself (`name`, `corner`).
 *
 * An output that can take another edge shows a `+`: clicking it opens the
 * picker and connects the picked block here.
 */
export function BlockHandle({
	blockId,
	kind,
	color,
	label,
	className,
	name = kind,
	maxConnections,
	corner,
	deprecated,
}: BlockHandleProps) {
	const config = HANDLE_CONFIG[kind];
	const id = handleId(blockId, name);
	const connections = useNodeConnections({ handleType: config.flow, handleId: id });
	const max = maxConnections === undefined ? config.maxConnections : maxConnections;
	const isConnectable = max === null || connections.length < max;
	const quickAdd = useQuickAdd();
	const showAdd = quickAdd !== null && config.flow === "source" && isConnectable;
	const side = corner ? (corner.startsWith("top") ? "top" : "bottom") : config.side;
	const text = label ?? config.label;
	const title = deprecated ? `${text} (deprecated): ${deprecated}` : text;

	const handle = (
		<Handle
			id={id}
			type={config.flow}
			position={corner ? (side === "top" ? Position.Top : Position.Bottom) : config.position}
			isConnectable={isConnectable}
			title={showAdd ? `${title} — click to add a block` : title}
			aria-label={`${text} handle`}
			data-label={text}
			className={[
				"fx-handle",
				`fx-handle--${config.shape}`,
				`fx-handle--${side}`,
				`fx-handle--${kind}`,
				isConnectable ? "" : "fx-handle--full",
				showAdd ? "fx-handle--add" : "",
				deprecated ? "fx-handle--deprecated" : "",
				className ?? "",
			]
				.filter(Boolean)
				.join(" ")}
			style={{ background: color ?? config.color }}
			// Spread, not `onClick={undefined}`: that would still override React Flow's own click handler.
			{...(showAdd && {
				onClick: () => quickAdd({ kind: "handle", nodeId: blockId, handle: name }),
			})}
		>
			{showAdd && <TbPlus className="fx-handle__plus" aria-hidden />}
		</Handle>
	);

	// Handles stacked on a corner each carry their name, and the slot is as wide as it,
	// so neighbours never overlap.
	return corner ? (
		<span
			className={`fx-handle-slot fx-handle-slot--${side}`}
			style={{ minWidth: `${text.length}ch` }}
		>
			{handle}
			<span className="fx-handle-slot__label">{text}</span>
		</span>
	) : (
		handle
	);
}
