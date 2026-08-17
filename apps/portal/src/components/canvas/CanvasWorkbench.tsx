import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Spinner, toast } from "@fluxify/components";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { CanvasItems, CanvasSavePayload } from "@/services/canvas";
import { BlockCanvas } from "./BlockCanvas";
import { createBlockNodeTypes } from "./blocks";
import { emptyGraph } from "./adapters";
import { findCycleEdgeIds } from "./cycleDetection";
import { saveWithDoctor, type ChangeSet } from "./changes";
import type { BlockData, CanvasGraph } from "./types";

/**
 * The canvas host, independent of what the canvas hangs off. Routes and custom
 * blocks store the same graph and serve it from the same endpoint shape, so the
 * only thing a caller supplies is how to load and save.
 */
export type CanvasWorkbenchProps = {
	title: string;
	items: { data: CanvasItems | undefined; isLoading: boolean; isError: boolean };
	/** Opt-in only: this workbench is reused by route, custom-block, and embedded canvases. */
	enableBlockPicker?: boolean;
	/** Opt-in only: the route owning the playground controls enables its trigger. */
	enablePlayground?: boolean;
	playgroundContent?: ReactNode;
	/** Extra header controls owned by the caller — route settings, for one. */
	headerActions?: ReactNode;
	/** Replaces the plain title on the left — the route switcher, for one. */
	headerLeft?: ReactNode;
	/** re-read from the server, for diagnosing a rejected save */
	reload: () => Promise<CanvasItems>;
	save: (payload: CanvasSavePayload) => Promise<unknown>;
};

function toGraph(data: CanvasItems | undefined): CanvasGraph {
	if (!data) return emptyGraph;
	return {
		blocks: data.blocks.map((block) => ({
			id: block.id,
			type: block.type,
			position: block.position,
			data: (block.data ?? {}) as BlockData,
		})),
		edges: data.edges,
	};
}

const nodeTypes = createBlockNodeTypes();

export function CanvasWorkbench({
	title,
	items,
	reload,
	save,
	enableBlockPicker = false,
	enablePlayground = false,
	playgroundContent,
	headerActions,
	headerLeft,
}: CanvasWorkbenchProps) {
	const [pendingCount, setPendingCount] = useState(0);
	const [isSaving, setIsSaving] = useState(false);
	const [cycleFeedbackToken, setCycleFeedbackToken] = useState(0);
	// Latest graph + delta reported by the canvas; only the delta gets saved.
	const edited = useRef<{ graph: CanvasGraph; changes: ChangeSet } | null>(null);

	async function onSave() {
		const current = edited.current;
		if (!current || isSaving) return;
		if (findCycleEdgeIds(current.graph.edges).size > 0) {
			setCycleFeedbackToken((token) => token + 1);
			toast.danger("Canvas contains a loop. Remove every red connection before saving.");
			return;
		}
		setIsSaving(true);
		try {
			const outcome = await saveWithDoctor({
				graph: current.graph,
				changes: current.changes,
				save,
				// Diagnose against what the server actually holds.
				loadServerGraph: async () => toGraph(await reload()),
			});
			edited.current = null;
			setPendingCount(0);
			toast.success(
				outcome.repaired
					? `Canvas saved after fixing ${outcome.notes.length} issue(s)`
					: "Canvas saved",
			);
		} catch (error) {
			// Both the save and the repaired retry failed — this is for the user.
			showErrorNotification(error as Error);
		} finally {
			setIsSaving(false);
		}
	}

	const graph = useMemo(() => toGraph(items.data), [items.data]);

	return (
		<div className="flex h-screen w-full flex-col">
			<header className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">
				{headerLeft ?? <span className="font-medium">{title}</span>}
				<div className="ml-auto flex items-center gap-2">{headerActions}</div>
				<Button
					variant="primary"
					isDisabled={pendingCount === 0 || isSaving}
					isPending={isSaving}
					onPress={() => void onSave()}
				>
					Save
				</Button>
			</header>

			<div className="min-h-0 flex-1">
				{items.isLoading ? (
					<div className="flex h-full items-center justify-center">
						<Spinner />
					</div>
				) : items.isError ? (
					<div className="flex h-full items-center justify-center text-muted">
						Couldn't load the graph.
					</div>
				) : (
					<BlockCanvas
						graph={graph}
						mode="edit"
						nodeTypes={nodeTypes}
						enableBlockPicker={enableBlockPicker}
						enablePlayground={enablePlayground}
						playgroundContent={playgroundContent}
						cycleFeedbackToken={cycleFeedbackToken}
						onSave={() => void onSave()}
						onChange={(next, changes) => {
							edited.current = { graph: next, changes };
							setPendingCount(changes.blocks.size + changes.edges.size);
						}}
					/>
				)}
			</div>
		</div>
	);
}
