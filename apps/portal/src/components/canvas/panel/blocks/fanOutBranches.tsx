import { sortByOrder } from "@fluxify/blocks/layout";
import { useNodeConnections, useNodesData, useReactFlow } from "@xyflow/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { blockLabels } from "../../blocks/blockLabels";
import { type HandleKind, handleId } from "../../blocks/handles/handleConfig";
import type { BlockNode } from "../../types";

/**
 * Lights one edge on the canvas. The class goes straight onto React Flow's edge
 * element, so hovering re-renders nothing.
 */
function useEdgeHighlight() {
	const lit = useRef<Element | null>(null);
	const clear = useCallback(() => {
		lit.current?.classList.remove("fx-edge--highlight");
		lit.current = null;
	}, []);
	// the panel can close while a row is hovered
	useEffect(() => clear, [clear]);
	const light = useCallback(
		(from: HTMLElement, edgeId: string) => {
			clear();
			const root = from.closest(".fx-canvas-shell") ?? document;
			lit.current = root.querySelector(`.react-flow__edge[data-id="${CSS.escape(edgeId)}"]`);
			lit.current?.classList.add("fx-edge--highlight");
		},
		[clear],
	);
	return { light, clear };
}

/**
 * The connections on a fan-out handle, sorted by the target ids stored in
 * `data.order`. Connections are read live from React Flow, so a new one shows up
 * last without touching the block; only reordering and removal write data.
 */
export function useFanOutBranches(block: BlockNode, kind: HandleKind) {
	const { updateNodeData, deleteElements } = useReactFlow();
	// both hooks compare shallowly: other canvas edits don't re-render the panel
	const connections = useNodeConnections({
		id: block.id,
		handleType: "source",
		handleId: handleId(block.id, kind),
	});
	const order = block.data.order as string[] | undefined;
	const branches = useMemo(
		() => sortByOrder(connections, order ?? [], (c) => c.target),
		[connections, order],
	);
	const targetIds = useMemo(() => branches.map((c) => c.target), [branches]);
	const targetIdsRef = useRef(targetIds);
	targetIdsRef.current = targetIds;

	const targets = useNodesData(targetIds);
	const names = new Map(targets.map((t) => [t.id, blockLabels(t.type ?? "", t.data).name]));
	const { light, clear } = useEdgeHighlight();

	const move = useCallback(
		(from: number, to: number) => {
			const ids = targetIdsRef.current;
			if (to < 0 || to >= ids.length || from === to) return;
			const next = [...ids];
			next.splice(to, 0, ...next.splice(from, 1));
			updateNodeData(block.id, { order: next });
		},
		[block.id, updateNodeData],
	);

	/** disconnects a branch; `data` is merged into the same block update */
	const remove = useCallback(
		(branch: { edgeId: string; target: string }, data: Record<string, unknown> = {}) => {
			clear();
			void deleteElements({ edges: [{ id: branch.edgeId }] });
			const ids = targetIdsRef.current.filter((id) => id !== branch.target);
			updateNodeData(block.id, { ...data, order: ids });
		},
		[block.id, clear, deleteElements, updateNodeData],
	);

	/** spread onto a ReorderableList so each row lights its edge */
	const highlightProps = {
		onItemMouseEnter: (branch: { edgeId: string }, el: HTMLElement) => light(el, branch.edgeId),
		onItemMouseLeave: clear,
		onItemFocus: (branch: { edgeId: string }, el: HTMLElement) => light(el, branch.edgeId),
		onItemBlur: clear,
		onDragStart: (branch: { edgeId: string }, _index: number, el: HTMLElement) =>
			light(el, branch.edgeId),
		onDragEnd: clear,
	};

	return { branches, names, move, remove, highlightProps };
}

export function FanOutEmptyState({
	title,
	icon,
	children,
}: {
	title: string;
	icon: ReactNode;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-secondary/30 px-4 py-6 text-center">
			<div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted">
				{icon}
			</div>
			<span className="text-xs font-semibold text-foreground">{title}</span>
			<p className="mt-1 max-w-[280px] text-xs leading-relaxed text-muted">{children}</p>
		</div>
	);
}
