import { useMemo, useRef, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button, Spinner, toast } from "@fluxify/components";
import { routesQuery } from "@/query/routesQuery";
import { routesService } from "@/services/routes";
import { showErrorNotification } from "@/lib/errorNotifier";
import {
	BlockCanvas,
	createBlockNodeTypes,
	emptyGraph,
	saveWithDoctor,
} from "@/components/canvas";
import type { BlockData, CanvasGraph, ChangeSet } from "@/components/canvas";

type ServerCanvas = Awaited<ReturnType<typeof routesService.getCanvasItems>>;

function toGraph(data: ServerCanvas | undefined): CanvasGraph {
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

export const Route = createFileRoute("/_authed/$projectId_/canvas/$routeId")({
	component: CanvasDemoPage,
});

const nodeTypes = createBlockNodeTypes();

/** Dummy host page for the canvas package — loads a route's graph client-side. */
function CanvasDemoPage() {
	const { routeId } = Route.useParams();
	const canvas = routesQuery.canvasItems.useQuery(routeId);
	const save = routesQuery.saveCanvas.mutation(routeId);
	const [readOnly, setReadOnly] = useState(false);
	const [pendingCount, setPendingCount] = useState(0);
	const [isSaving, setIsSaving] = useState(false);
	// Latest graph + delta reported by the canvas; only the delta gets saved.
	const edited = useRef<{ graph: CanvasGraph; changes: ChangeSet } | null>(null);

	async function onSave() {
		const current = edited.current;
		if (!current || isSaving) return;
		setIsSaving(true);
		try {
			const outcome = await saveWithDoctor({
				graph: current.graph,
				changes: current.changes,
				save: (payload) => save.mutateAsync(payload),
				// Diagnose against what the server actually holds.
				loadServerGraph: async () =>
					toGraph(await routesService.getCanvasItems(routeId)),
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

	const graph = useMemo(() => toGraph(canvas.data), [canvas.data]);

	return (
		<div className="flex h-screen w-full flex-col">
			<header className="flex items-center gap-4 border-b border-border px-4 py-2 text-sm">
				<span className="font-medium">Canvas sandbox</span>
				<label className="flex items-center gap-2">
					<input
						type="checkbox"
						checked={readOnly}
						onChange={(e) => setReadOnly(e.target.checked)}
					/>
					Read only
				</label>
				<span className="text-muted">
					{graph.blocks.length} blocks · {graph.edges.length} edges ·{" "}
					{pendingCount} unsaved
				</span>
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
				{canvas.isLoading ? (
					<div className="flex h-full items-center justify-center">
						<Spinner />
					</div>
				) : canvas.isError ? (
					<div className="flex h-full items-center justify-center text-muted">
						Couldn't load the graph.
					</div>
				) : (
					<BlockCanvas
						graph={graph}
						mode={readOnly ? "readonly" : "edit"}
						nodeTypes={nodeTypes}
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
