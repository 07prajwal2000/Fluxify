import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNodeConnections, useNodesData, useReactFlow } from "@xyflow/react";
import { TbGitBranch } from "react-icons/tb";
import { ReorderableList } from "@fluxify/components";
import { sortByOrder } from "@fluxify/blocks/layout";
import { BlockSettings } from "../BlockSettings";
import { BlockSelectField } from "../fields";
import { blockLabels } from "../../blocks/blockLabels";
import { handleId } from "../../blocks/handles/handleConfig";
import { useCanvasChanges } from "../../changes/ChangesContext";
import type { BlockNode } from "../../types";

const ON_ERROR_OPTIONS = [
	{ value: "throw", label: "Stop and run the error handler" },
	{ value: "settle", label: "Finish every branch" },
];

/**
 * Lights one edge on the canvas. The class goes straight onto React Flow's edge
 * element, so hovering re-renders nothing.
 */
function useEdgeHighlight() {
	const lit = useRef<Element | null>(null);
	const clear = () => {
		lit.current?.classList.remove("fx-edge--highlight");
		lit.current = null;
	};
	// the panel can close while a row is hovered
	useEffect(() => clear, []);
	const light = (from: HTMLElement, edgeId: string) => {
		clear();
		const root = from.closest(".fx-canvas-shell") ?? document;
		lit.current = root.querySelector(`.react-flow__edge[data-id="${CSS.escape(edgeId)}"]`);
		lit.current?.classList.add("fx-edge--highlight");
	};
	return { light, clear };
}

/**
 * The branches wired to the orchestrate handle, in output order. Connections are
 * read live from React Flow; only the order (target ids) is stored on the block.
 */
export function OrchestratorBranches({ block }: { block: BlockNode }) {
	const { updateNodeData, deleteElements } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	// both hooks compare shallowly: other canvas edits don't re-render this
	const connections = useNodeConnections({
		id: block.id,
		handleType: "source",
		handleId: handleId(block.id, "orchestrate"),
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

	const removeBranch = useCallback(
		(branch: (typeof branches)[0]) => {
			clear();
			void deleteElements({ edges: [{ id: branch.edgeId }] });
			const ids = targetIdsRef.current.filter((id) => id !== branch.target);
			updateNodeData(block.id, { order: ids });
		},
		[block.id, clear, deleteElements, updateNodeData],
	);

	if (branches.length === 0) {
		return (
			<div className="flex flex-col gap-2">
				<span className="text-sm font-medium text-foreground">Branch order</span>
				<div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-secondary/30 px-4 py-6 text-center">
					<div className="mb-2 flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted">
						<TbGitBranch className="h-4.5 w-4.5" />
					</div>
					<span className="text-xs font-semibold text-foreground">
						No branches connected
					</span>
					<p className="mt-1 max-w-[280px] text-xs leading-relaxed text-muted">
						Connect blocks to the <strong className="font-medium text-foreground">Branches</strong> handle on top of this block. Each connected chain runs at the same time.
					</p>
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-2">
			<span className="text-sm font-medium text-foreground">Branch order</span>
			<ReorderableList
				items={branches}
				getKey={(branch) => branch.edgeId}
				getItemLabel={(branch) => names.get(branch.target) ?? branch.target}
				isEditable={editable}
				showIndex
				showMoveButtons
				onMove={move}
				onRemove={removeBranch}
				removeButtonAriaLabel="Disconnect branch"
				onItemMouseEnter={(branch, el) => light(el, branch.edgeId)}
				onItemMouseLeave={clear}
				onItemFocus={(branch, el) => light(el, branch.edgeId)}
				onItemBlur={clear}
				onDragStart={(branch, _index, el) => light(el, branch.edgeId)}
				onDragEnd={clear}
			/>
			<span className="text-xs text-muted">
				The next block gets an array: index 0 is the first branch's output.
			</span>
		</div>
	);
}

export function orchestratorSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="onError"
				label="When a branch fails"
				options={ON_ERROR_OPTIONS}
				hint="Finish every branch: a failed branch's slot holds its error message instead of an output."
			/>
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="branches" name="Branches">
			<OrchestratorBranches block={block} />
		</BlockSettings.TabHead>,
	];
}
