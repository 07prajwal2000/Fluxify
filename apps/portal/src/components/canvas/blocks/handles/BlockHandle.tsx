import { Handle, useNodeConnections } from "@xyflow/react";
import { HANDLE_CONFIG, handleId, type HandleKind } from "./handleConfig";

export type BlockHandleProps = {
	blockId: string;
	kind: HandleKind;
	/** Overrides the themed colour for this socket. */
	color?: string;
	/** Overrides the tooltip / aria label. */
	label?: string;
	className?: string;
};

/**
 * A single socket. Placement comes from the kind (see HANDLE_CONFIG) — the
 * parent BaseBlock buckets handles onto the correct edge rail, so callers just
 * declare `<BlockHandle kind="success" />` as a child of the block.
 */
export function BlockHandle({
	blockId,
	kind,
	color,
	label,
	className,
}: BlockHandleProps) {
	const config = HANDLE_CONFIG[kind];
	const id = handleId(blockId, kind);
	const connections = useNodeConnections({ handleType: config.flow, handleId: id });
	const isConnectable =
		config.maxConnections === null ||
		connections.length < config.maxConnections;

	return (
		<Handle
			id={id}
			type={config.flow}
			position={config.position}
			isConnectable={isConnectable}
			title={label ?? config.label}
			aria-label={`${label ?? config.label} handle`}
			className={[
				"fx-handle",
				`fx-handle--${config.shape}`,
				`fx-handle--${config.side}`,
				isConnectable ? "" : "fx-handle--full",
				className ?? "",
			]
				.filter(Boolean)
				.join(" ")}
			style={{ background: color ?? config.color }}
		/>
	);
}
