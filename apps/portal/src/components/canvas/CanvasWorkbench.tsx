import { Button, Spinner, toast } from "@fluxify/components";
import { type ReactNode, useMemo, useRef, useState } from "react";

import { showErrorNotification } from "@/lib/errorNotifier";
import type { CanvasItems, CanvasSavePayload } from "@/services/canvas";
import { emptyGraph } from "./adapters";
import { BlockCanvas } from "./BlockCanvas";
import { createBlockNodeTypes } from "./blocks";
import { type ChangeSet, saveWithDoctor } from "./changes";
import { findCycleEdgeIds } from "./cycleDetection";
import { CanvasDiagnosticsProvider, useBlockDiagnostics } from "./diagnostics";
import { COMPILE_SOURCE } from "./diagnostics/compileDiagnostics";
import { blockDiagnosticsFromSaveError, SAVE_SOURCE } from "./diagnostics/saveErrorDiagnostics";
import { type CompileTarget, useCompileDiagnostics } from "./diagnostics/useCompileDiagnostics";
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
	/** Opt-in only: enables the Spotlight command palette (Cmd/Ctrl+K or Cmd/Ctrl+Space). */
	enableSpotlight?: boolean;
	playgroundContent?: ReactNode;
	/** Extra header controls owned by the caller — route settings, for one. */
	headerActions?: ReactNode;
	/** Replaces the plain title on the left — the route switcher, for one. */
	headerLeft?: ReactNode;
	/** re-read from the server, for diagnosing a rejected save */
	reload: () => Promise<CanvasItems>;
	save: (payload: CanvasSavePayload) => Promise<unknown>;
	/** what the compiler reports this canvas as, so its result can be shown */
	compileTarget: CompileTarget;
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

export function CanvasWorkbench(props: CanvasWorkbenchProps) {
	return (
		<CanvasDiagnosticsProvider>
			<CanvasWorkbenchInner {...props} />
		</CanvasDiagnosticsProvider>
	);
}

function CanvasWorkbenchInner({
	title,
	items,
	reload,
	save,
	compileTarget,
	enableBlockPicker = false,
	enablePlayground = false,
	enableSpotlight = false,
	playgroundContent,
	headerActions,
	headerLeft,
}: CanvasWorkbenchProps) {
	const [pendingCount, setPendingCount] = useState(0);
	const [isSaving, setIsSaving] = useState(false);
	const [cycleFeedbackToken, setCycleFeedbackToken] = useState(0);
	// Latest graph + delta reported by the canvas; only the delta gets saved.
	const edited = useRef<{ graph: CanvasGraph; changes: ChangeSet } | null>(null);
	const diagnostics = useBlockDiagnostics();

	async function onSave() {
		const current = edited.current;
		if (!current || isSaving) return;
		if (findCycleEdgeIds(current.graph.edges).size > 0) {
			setCycleFeedbackToken((token) => token + 1);
			toast.danger("Canvas contains a loop. Remove every red connection before saving.");
			return;
		}
		// compile errors are about the saved version; saving is how they get fixed
		const errors = diagnostics.all.filter(
			(d) => d.severity === "error" && d.source !== COMPILE_SOURCE,
		).length;
		if (errors > 0) {
			diagnostics.openPanel();
			toast.danger(`Fix ${errors} error(s) before saving. See diagnostics.`);
			return;
		}
		setIsSaving(true);
		diagnostics.clearSource(SAVE_SOURCE);
		try {
			const lastCompileId = await compile.baseline();
			const outcome = await saveWithDoctor({
				graph: current.graph,
				changes: current.changes,
				save,
				// Diagnose against what the server actually holds.
				loadServerGraph: async () => toGraph(await reload()),
			});
			// cleared before waiting, so edits made during the compile stay pending
			edited.current = null;
			setPendingCount(0);
			const saved = outcome.repaired
				? `Canvas saved after fixing ${outcome.notes.length} issue(s)`
				: "Canvas saved";
			const log = await compile.waitForCompile(lastCompileId);
			if (!log) toast.warning(`${saved}, still compiling`);
			else if (log.detail?.status === "failed") {
				toast.danger(`${saved}, but it did not compile. See diagnostics.`);
			} else toast.success(saved);
		} catch (error) {
			// Both the save and the repaired retry failed — this is for the user.
			const blockErrors = blockDiagnosticsFromSaveError(error, current.graph);
			if (blockErrors) {
				diagnostics.setFromSource(SAVE_SOURCE, blockErrors);
				toast.danger("Failed to save canvas", {
					actionProps: { children: "View diagnostics", onPress: diagnostics.openPanel },
				});
			} else {
				showErrorNotification(error as Error);
			}
		} finally {
			setIsSaving(false);
		}
	}

	const graph = useMemo(() => toGraph(items.data), [items.data]);
	const compile = useCompileDiagnostics(compileTarget, graph.blocks);

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
						enableSpotlight={enableSpotlight}
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
