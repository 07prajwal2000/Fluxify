import { useCallback, useMemo, useState } from "react";
import { useReactFlow } from "@xyflow/react";
import { Button, toast } from "@fluxify/components";
import {
	TbAlertCircle,
	TbAlertTriangle,
	TbCheck,
	TbChevronsRight,
	TbInfoCircle,
	TbRefresh,
	TbStethoscope,
} from "react-icons/tb";
import { CustomBlockIcon } from "@/components/customBlocks/IconPicker";
import { blockIcon } from "../blocks/blockIconMap";
import { blockLabels } from "../blocks/blockLabels";
import { useCustomBlockDefs } from "../blocks/useCustomBlockDefs";
import { useBlockPanelResize } from "../panel/useBlockPanelResize";
import { useBlockDiagnostics } from "./DiagnosticsContext";
import type { BlockDiagnostic } from "./types";
import "../panel/panel.css";

export const DIAGNOSTICS_PANEL_WIDTH_KEY = "fx-diagnostics-panel-width";

export type DiagnosticsPanelProps = {
	isOpen: boolean;
	onClose: () => void;
	onSelectBlock?: (blockId: string) => void;
	defaultWidth?: number;
	minWidth?: number;
	maxWidth?: number;
	storageKey?: string;
};

export function DiagnosticsPanel({
	isOpen,
	onClose,
	onSelectBlock,
	defaultWidth,
	minWidth,
	maxWidth,
	storageKey = DIAGNOSTICS_PANEL_WIDTH_KEY,
}: DiagnosticsPanelProps) {
	const { all, byBlock, revalidate, worstSeverity } = useBlockDiagnostics();
	const { getNode } = useReactFlow();
	const customBlockDefs = useCustomBlockDefs();

	const {
		width,
		isResizing,
		handleMouseDown,
		handleTouchStart,
		handleDoubleClick,
		handleKeyDown,
		minWidth: resolvedMinWidth,
		maxWidth: resolvedMaxWidth,
	} = useBlockPanelResize({
		defaultWidth,
		minWidth,
		maxWidth,
		storageKey,
		onClose,
	});

	const blockEntries = useMemo(() => {
		const entries: Array<{
			blockId: string;
			name: string;
			type: string;
			customDef?: (typeof customBlockDefs)[number];
			diagnostics: BlockDiagnostic[];
			errorCount: number;
			warningCount: number;
			infoCount: number;
		}> = [];

		for (const [blockId, diagnostics] of byBlock.entries()) {
			if (diagnostics.length === 0) continue;
			const node = getNode(blockId);
			const type = (node?.type as string) ?? "unknown";
			const customDef = customBlockDefs.find((def) => def.name === type);
			const { name } = blockLabels(type, node?.data);

			let errorCount = 0;
			let warningCount = 0;
			let infoCount = 0;
			for (const d of diagnostics) {
				if (d.severity === "error") errorCount++;
				else if (d.severity === "warning") warningCount++;
				else if (d.severity === "info") infoCount++;
			}

			entries.push({
				blockId,
				name: customDef ? (name || customDef.label) : name,
				type,
				customDef,
				diagnostics,
				errorCount,
				warningCount,
				infoCount,
			});
		}

		// Sort by error count desc, then warning count desc, then name
		entries.sort((a, b) => {
			if (b.errorCount !== a.errorCount) return b.errorCount - a.errorCount;
			if (b.warningCount !== a.warningCount) return b.warningCount - a.warningCount;
			return a.name.localeCompare(b.name);
		});

		return entries;
	}, [byBlock, customBlockDefs, getNode]);

	const totalErrors = useMemo(
		() => all.filter((d) => d.severity === "error").length,
		[all],
	);
	const totalWarnings = useMemo(
		() => all.filter((d) => d.severity === "warning").length,
		[all],
	);
	const totalInfo = useMemo(
		() => all.filter((d) => d.severity === "info").length,
		[all],
	);

	const [isValidating, setIsValidating] = useState(false);

	const handleRevalidate = useCallback(async () => {
		if (isValidating) return;
		setIsValidating(true);
		try {
			const updated = revalidate();
			await new Promise((resolve) => setTimeout(resolve, 500));
			const errors = updated.filter((d) => d.severity === "error").length;
			const warnings = updated.filter((d) => d.severity === "warning").length;
			if (errors > 0) {
				toast.danger(`Revalidation complete: ${errors} error(s) found`);
			} else if (warnings > 0) {
				toast.warning(`Revalidation complete: ${warnings} warning(s) found`);
			} else {
				toast.success("Diagnostics revalidated: canvas graph is clean");
			}
		} finally {
			setIsValidating(false);
		}
	}, [isValidating, revalidate]);

	const handleItemClick = useCallback(
		(blockId: string) => {
			onSelectBlock?.(blockId);
		},
		[onSelectBlock],
	);

	return (
		<aside
			className={`fx-panel${isOpen ? " fx-panel--open" : ""}${isResizing ? " fx-panel--resizing" : ""}`}
			style={{
				width: isOpen ? `${width}px` : 0,
			}}
			aria-label="Canvas diagnostics"
			aria-hidden={!isOpen}
		>
			{isOpen && (
				<div
					className="fx-panel__resize-handle"
					role="separator"
					tabIndex={0}
					aria-orientation="vertical"
					aria-label="Resize diagnostics panel"
					aria-valuenow={Math.round(width)}
					aria-valuemin={Number.isFinite(resolvedMinWidth) ? resolvedMinWidth : 0}
					aria-valuemax={Number.isFinite(resolvedMaxWidth) ? resolvedMaxWidth : 9999}
					onMouseDown={handleMouseDown}
					onTouchStart={handleTouchStart}
					onDoubleClick={handleDoubleClick}
					onKeyDown={handleKeyDown}
					title="Drag to resize panel (double-click to reset)"
				>
					<div className="fx-panel__resize-knob">
						<svg
							width="6"
							height="12"
							viewBox="0 0 6 12"
							fill="currentColor"
							aria-hidden="true"
							className="fx-panel__resize-icon"
						>
							<rect x="0" y="0" width="2" height="12" rx="1" />
							<rect x="4" y="0" width="2" height="12" rx="1" />
						</svg>
					</div>
				</div>
			)}

			<header className="fx-panel__header">
				<span
					className={`fx-panel__icon ${
						worstSeverity === "error"
							? "text-danger"
							: worstSeverity === "warning"
								? "text-warning"
								: worstSeverity === "info"
									? "text-sky-500"
									: "text-muted"
					}`}
				>
					<TbStethoscope size={18} />
				</span>
				<div className="flex flex-col">
					<span className="fx-panel__name">Diagnostics</span>
					<span className="text-[11px] text-muted">
						{all.length === 0
							? "All checks passed"
							: `${totalErrors} error(s), ${totalWarnings} warning(s)`}
					</span>
				</div>
				<div className="ml-auto flex items-center gap-2">
					<Button
						variant="secondary"
						size="sm"
						isPending={isValidating}
						isDisabled={isValidating}
						onPress={() => void handleRevalidate()}
						aria-label="Revalidate"
						className="h-7 px-2 text-xs"
					>
						<TbRefresh size={13} className="mr-1" />
						Revalidate
					</Button>
					<button
						type="button"
						className="fx-panel__close"
						title="Collapse panel"
						aria-label="Collapse diagnostics panel"
						onClick={onClose}
					>
						<TbChevronsRight />
					</button>
				</div>
			</header>

			<div className="fx-panel__body flex flex-col gap-3 overflow-y-auto p-3">
				{blockEntries.length === 0 ? (
					<div className="flex flex-col items-center justify-center gap-2 py-12 text-center text-muted">
						<span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-secondary text-success">
							<TbCheck size={20} />
						</span>
						<p className="font-medium text-foreground">Canvas graph is clean</p>
						<p className="max-w-[240px] text-xs">
							No errors, cyclic loops, or warnings detected in current blocks.
						</p>
					</div>
				) : (
					blockEntries.map((entry) => (
						<div
							key={entry.blockId}
							className="flex flex-col rounded-md border border-border bg-surface-secondary/20 p-2.5 transition-colors hover:border-border-hover"
						>
							<button
								type="button"
								onClick={() => handleItemClick(entry.blockId)}
								className="flex w-full items-center gap-2 text-left hover:opacity-90"
							>
								<span className="text-muted">
									{entry.customDef ? (
										<CustomBlockIcon
											icon={entry.customDef.icon}
											iconUrl={entry.customDef.iconUrl}
										/>
									) : (
										blockIcon(entry.type)
									)}
								</span>
								<span className="font-medium text-foreground text-xs truncate max-w-[180px]">
									{entry.name}
								</span>
								<span className="font-mono text-[10px] text-muted">
									{entry.blockId.slice(0, 8)}
								</span>
								<div className="ml-auto flex items-center gap-1">
									{entry.errorCount > 0 && (
										<span className="inline-flex items-center gap-0.5 rounded bg-danger/10 px-1.5 py-0.5 font-semibold text-[10px] text-danger">
											<TbAlertCircle size={11} />
											{entry.errorCount}
										</span>
									)}
									{entry.warningCount > 0 && (
										<span className="inline-flex items-center gap-0.5 rounded bg-warning/10 px-1.5 py-0.5 font-semibold text-[10px] text-warning">
											<TbAlertTriangle size={11} />
											{entry.warningCount}
										</span>
									)}
									{entry.infoCount > 0 && (
										<span className="inline-flex items-center gap-0.5 rounded bg-sky-500/10 px-1.5 py-0.5 font-semibold text-[10px] text-sky-500">
											<TbInfoCircle size={11} />
											{entry.infoCount}
										</span>
									)}
								</div>
							</button>

							<div className="mt-2 flex flex-col gap-1.5 border-t border-border/50 pt-2">
								{entry.diagnostics.map((diag, idx) => (
									<button
										key={`${diag.source}-${idx}`}
										type="button"
										onClick={() => handleItemClick(entry.blockId)}
										className="flex w-full items-start gap-2 rounded p-1.5 text-left text-xs transition-colors hover:bg-surface-secondary"
									>
										<span className="mt-0.5 shrink-0">
											{diag.severity === "error" ? (
												<TbAlertCircle className="text-danger" size={14} />
											) : diag.severity === "warning" ? (
												<TbAlertTriangle className="text-warning" size={14} />
											) : (
												<TbInfoCircle className="text-sky-500" size={14} />
											)}
										</span>
										<div className="flex min-w-0 flex-1 flex-col">
											<p className="leading-snug text-foreground">{diag.message}</p>
											<span className="text-[10px] text-muted">{diag.source}</span>
										</div>
									</button>
								))}
							</div>
						</div>
					))
				)}
			</div>
		</aside>
	);
}
