import { Handle, Position } from "@xyflow/react";

export type GenericNodeData = {
	label?: string;
	name?: string;
	targets?: string[];
	sources?: string[];
};

// ponytail: Stage 2 node — generic visual, but renders the exact handle IDs its
// edges reference (derived in the editor route) so connections draw correctly
// for any block type. Stage 3 swaps in per-type icons/UIs.
export function GenericBlockNode({
	data,
	type,
	selected,
}: {
	data?: GenericNodeData;
	type?: string;
	selected?: boolean;
}) {
	const targets = data?.targets ?? [];
	const sources = data?.sources ?? [];

	return (
		<div
			className={`min-w-44 rounded-md border bg-surface px-3 py-2 shadow transition-colors ${
				selected ? "border-accent" : "border-border"
			}`}
		>
			{targets.length === 0 ? (
				<Handle type="target" position={Position.Top} className="!bg-accent" />
			) : (
				targets.map((id, i) => (
					<Handle
						key={id}
						id={id}
						type="target"
						position={Position.Top}
						style={{ left: `${((i + 1) / (targets.length + 1)) * 100}%` }}
						className="!bg-accent"
					/>
				))
			)}

			<div className="text-[10px] font-medium uppercase tracking-wide text-muted">
				{type}
			</div>
			<div className="text-sm font-medium text-foreground">
				{data?.label ?? data?.name ?? type ?? "Block"}
			</div>

			{sources.length === 0 ? (
				<Handle type="source" position={Position.Bottom} className="!bg-accent" />
			) : (
				sources.map((id, i) => (
					<Handle
						key={id}
						id={id}
						type="source"
						position={Position.Bottom}
						style={{ left: `${((i + 1) / (sources.length + 1)) * 100}%` }}
						className="!bg-accent"
					/>
				))
			)}
		</div>
	);
}
