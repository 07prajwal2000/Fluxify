import { Alert, Button, Spinner, toast } from "@fluxify/components";
import { type ReactNode, useMemo, useRef, useState } from "react";
import { TbRefresh } from "react-icons/tb";

import type { CanvasItems, CanvasSavePayload } from "@/services/canvas";
import { emptyGraph } from "./adapters";
import { BlockCanvas } from "./BlockCanvas";
import { createBlockNodeTypes } from "./blocks";
import { type ChangeSet, saveWithDoctor } from "./changes";
import { findCycleEdgeIds } from "./cycleDetection";
import { CanvasDiagnosticsProvider, useBlockDiagnostics } from "./diagnostics";
import { COMPILE_SOURCE } from "./diagnostics/compileDiagnostics";
import {
	blockDiagnosticsFromSaveError,
	blockDiagnosticsFromSaveResult,
	SAVE_CHECK_SOURCE,
	SAVE_SOURCE,
} from "./diagnostics/saveErrorDiagnostics";
import { type CompileTarget, useCompileDiagnostics } from "./diagnostics/useCompileDiagnostics";
import type { BlockData, CanvasGraph } from "./types";
import { useCanvasPoll } from "./useCanvasPoll";

/**
 * The canvas host, independent of what the canvas hangs off. Routes and custom
 * blocks store the same graph and serve it from the same endpoint shape, so the
 * only thing a caller supplies is how to load and save.
 */
export type CanvasWorkbenchProps = {
	title: string;
	items: {
		data: CanvasItems | undefined;
		isLoading: boolean;
		isError: boolean;
		refetch: () => Promise<unknown>;
	};
	/** Opt-in only: this workbench is reused by route, custom-block, and embedded canvases. */
	enableBlockPicker?: boolean;
	/** Opt-in only: the route owning the playground controls enables its trigger. */
	enablePlayground?: boolean;
	/** Opt-in only: enables the Spotlight command palette (Cmd/Ctrl+K or Cmd/Ctrl+Space). */
	enableSpotlight?: boolean;
	playgroundContent?: ReactNode;
	/** the playground's "Track Execution" tab; leave out for users who can't see recordings */
	trackExecutionContent?: ReactNode;
	/** Extra header controls owned by the caller — route settings, for one. */
	headerActions?: ReactNode;
	/** Replaces the plain title on the left — the route switcher, for one. */
	headerLeft?: ReactNode;
	/** re-read from the server, for diagnosing a rejected save */
	reload: () => Promise<CanvasItems>;
	save: (payload: CanvasSavePayload) => Promise<unknown>;
	/** the server's canvas version, polled to spot changes made elsewhere (#597) */
	getVersion: () => Promise<number>;
	/** what the compiler reports this canvas as, so its result can be shown */
	compileTarget: CompileTarget;
	/** view only: no edits, no Save — for users who may look but not change */
	readOnly?: boolean;
	/** open on a block that failed in a test run */
	focusBlock?: { blockId: string; error?: string };
};

export function toGraph(data: CanvasItems | undefined): CanvasGraph {
	if (!data) return emptyGraph;
	return {
		blocks: data.blocks.map((block) => ({
			id: block.id,
			type: block.type,
			position: block.position,
			data: (block.data ?? {}) as BlockData,
			key: block.key,
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
	getVersion,
	compileTarget,
	enableBlockPicker = false,
	enablePlayground = false,
	enableSpotlight = false,
	playgroundContent,
	trackExecutionContent,
	headerActions,
	headerLeft,
	readOnly = false,
	focusBlock,
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
		// fresh run: drops the last save's errors and anything fixed since
		// compile errors are about the saved version; saving is how they get fixed
		const shown = diagnostics.revalidate();
		const errors = shown.filter(
			(d) => d.severity === "error" && d.source !== COMPILE_SOURCE,
		).length;
		if (errors > 0) {
			diagnostics.openPanel();
			toast.danger(`Fix ${errors} error(s) before saving. See diagnostics.`);
			return;
		}
		setIsSaving(true);
		try {
			const lastCompileId = await compile.baseline();
			const outcome = await saveWithDoctor({
				graph: current.graph,
				changes: current.changes,
				save,
				// Diagnose against what the server actually holds.
				loadServerGraph: async () => toGraph(await reload()),
			});
			diagnostics.setFromSource(
				SAVE_CHECK_SOURCE,
				blockDiagnosticsFromSaveResult(outcome.result, current.graph, shown),
			);
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
			const saveErrors = blockDiagnosticsFromSaveError(error, current.graph);
			diagnostics.setFromSource(SAVE_SOURCE, saveErrors);
			toast.danger(
				saveErrors.length === 1
					? saveErrors[0].message
					: `Failed to save canvas (${saveErrors.length} errors)`,
				{ actionProps: { children: "View diagnostics", onPress: diagnostics.openPanel } },
			);
		} finally {
			setIsSaving(false);
		}
	}

	const graph = useMemo(() => toGraph(items.data), [items.data]);
	const compile = useCompileDiagnostics(compileTarget, graph.blocks);

	// Changed by AI or another user: take the server's canvas, dropping local edits.
	const [reloadToken, setReloadToken] = useState(0);
	async function reloadFromServer() {
		await items.refetch();
		edited.current = null;
		setPendingCount(0);
		setReloadToken((token) => token + 1);
	}
	const stale = useCanvasPoll({
		version: items.data?.canvasVersion,
		isDirty: pendingCount > 0,
		isSaving,
		getVersion,
		reload: () => void reloadFromServer(),
	});

	return (
		<div className="flex h-screen w-full flex-col">
			<header className="flex items-center gap-3 border-b border-border px-4 py-2 text-sm">
				{headerLeft ?? <span className="font-medium">{title}</span>}
				<div className="ml-auto flex items-center gap-2">{headerActions}</div>
				{!readOnly && (
					<Button
						variant="primary"
						isDisabled={pendingCount === 0 || isSaving}
						isPending={isSaving}
						onPress={() => void onSave()}
					>
						Save
					</Button>
				)}
			</header>

			{stale && (
				<Alert status="warning" className="rounded-none">
					<Alert.Content>
						<Alert.Description>Changed by AI or another user. Reload?</Alert.Description>
					</Alert.Content>
					<Button size="sm" variant="outline" onPress={() => void reloadFromServer()}>
						<TbRefresh size={14} /> Reload
					</Button>
				</Alert>
			)}

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
						mode={readOnly ? "readonly" : "edit"}
						nodeTypes={nodeTypes}
						enableBlockPicker={enableBlockPicker}
						enablePlayground={enablePlayground}
						enableSpotlight={enableSpotlight}
						playgroundContent={playgroundContent}
						trackExecutionContent={trackExecutionContent}
						focusBlock={focusBlock}
						cycleFeedbackToken={cycleFeedbackToken}
						reloadToken={reloadToken}
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
