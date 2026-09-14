import { useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Spinner, toast } from "@fluxify/components";
import {
	TbAlertCircle,
	TbAlertTriangle,
	TbCheck,
	TbInfoCircle,
} from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { CanvasItems, CanvasSavePayload } from "@/services/canvas";
import { BlockCanvas } from "./BlockCanvas";
import { createBlockNodeTypes } from "./blocks";
import { emptyGraph } from "./adapters";
import { findCycleEdgeIds } from "./cycleDetection";
import { saveWithDoctor, type ChangeSet } from "./changes";
import { CanvasDiagnosticsProvider, useBlockDiagnostics } from "./diagnostics";
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

function CanvasDiagnosticsOpener() {
	const { all, worstSeverity, togglePanel, isPanelOpen } = useBlockDiagnostics();

	const errorCount = all.filter((d) => d.severity === "error").length;
	const warningCount = all.filter((d) => d.severity === "warning").length;

	let icon = <TbCheck className="text-success" size={16} />;
	let titleText = "Diagnostics: Clean (0 issues)";

	if (worstSeverity === "error") {
		icon = <TbAlertCircle className="text-danger" size={16} />;
		titleText = `Diagnostics: ${errorCount} error(s)`;
	} else if (worstSeverity === "warning") {
		icon = <TbAlertTriangle className="text-warning" size={16} />;
		titleText = `Diagnostics: ${warningCount} warning(s)`;
	} else if (worstSeverity === "info") {
		icon = <TbInfoCircle className="text-sky-500" size={16} />;
		titleText = "Diagnostics: Info notice(s)";
	}

	return (
		<Button
			variant="secondary"
			size="sm"
			aria-label={titleText}
			onPress={togglePanel}
			className={`h-8 gap-1.5 px-2.5 ${isPanelOpen ? "bg-surface-secondary" : ""}`}
		>
			{icon}
			<span className="text-xs font-medium">
				{all.length === 0 ? "Clean" : all.length}
			</span>
		</Button>
	);
}

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
				<CanvasDiagnosticsOpener />
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
