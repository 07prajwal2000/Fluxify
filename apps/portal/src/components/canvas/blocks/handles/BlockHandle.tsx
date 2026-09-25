import { Handle, useNodeConnections } from "@xyflow/react";
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
};

/**
 * A single socket. Placement comes from the kind (see HANDLE_CONFIG) — the
 * parent BaseBlock buckets handles onto the correct edge rail, so callers just
 * declare `<BlockHandle kind="success" />` as a child of the block.
 *
 * An output that can take another edge shows a `+`: clicking it opens the
 * picker and connects the picked block here.
 */
export function BlockHandle({ blockId, kind, color, label, className }: BlockHandleProps) {
	const config = HANDLE_CONFIG[kind];
	const id = handleId(blockId, kind);
	const connections = useNodeConnections({ handleType: config.flow, handleId: id });
	const isConnectable =
		config.maxConnections === null || connections.length < config.maxConnections;
	const quickAdd = useQuickAdd();
	const showAdd = quickAdd !== null && config.flow === "source" && isConnectable;

	return (
		<Handle
			id={id}
			type={config.flow}
			position={config.position}
			isConnectable={isConnectable}
			title={showAdd ? `${label ?? config.label} — click to add a block` : (label ?? config.label)}
			aria-label={`${label ?? config.label} handle`}
			className={[
				"fx-handle",
				`fx-handle--${config.shape}`,
				`fx-handle--${config.side}`,
				isConnectable ? "" : "fx-handle--full",
				showAdd ? "fx-handle--add" : "",
				className ?? "",
			]
				.filter(Boolean)
				.join(" ")}
			style={{ background: color ?? config.color }}
			// Spread, not `onClick={undefined}`: that would still override React Flow's own click handler.
			{...(showAdd && {
				onClick: () => quickAdd({ kind: "handle", nodeId: blockId, handle: kind }),
			})}
		>
			{showAdd && <TbPlus className="fx-handle__plus" aria-hidden />}
		</Handle>
	);
}
