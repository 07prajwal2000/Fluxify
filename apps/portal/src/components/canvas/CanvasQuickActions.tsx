import { Button, Spinner } from "@fluxify/components";
import { TbNote, TbPlayerPlay, TbPlus, TbStethoscope } from "react-icons/tb";
import { useBlockDiagnostics } from "./diagnostics";

export type CanvasQuickActionsProps = {
	enableBlockPicker: boolean;
	enablePlayground: boolean;
	onOpenBlockPicker: () => void;
	onAddNote: () => void;
	onOpenPlayground: () => void;
};

/** Floating canvas toolbar: add a block, drop a note, open the API playground. */
export function CanvasQuickActions({
	enableBlockPicker,
	enablePlayground,
	onOpenBlockPicker,
	onAddNote,
	onOpenPlayground,
}: CanvasQuickActionsProps) {
	const { all, worstSeverity, togglePanel, isPanelOpen } = useBlockDiagnostics();
	const pending = all.some((d) => d.pending);
	const dot = worstSeverity === "error" ? "bg-danger" : worstSeverity === "warning" ? "bg-warning" : null;

	return (
		<div className="fx-canvas__quick-actions">
			{enableBlockPicker && (
				<>
					<Button
						aria-label="Add block"
						className="fx-canvas__quick-action fx-canvas__expandable-action fx-canvas__add-block-action bg-surface text-foreground hover:bg-surface-secondary"
						onPress={onOpenBlockPicker}
					>
						<TbPlus className="fx-canvas__expandable-icon" />
						<span className="fx-canvas__expandable-label">Add New Block</span>
					</Button>
					<Button
						aria-label="Add note"
						className="fx-canvas__quick-action fx-canvas__expandable-action fx-canvas__note-action bg-surface text-foreground hover:bg-surface-secondary"
						onPress={onAddNote}
					>
						<TbNote className="fx-canvas__expandable-icon" />
						<span className="fx-canvas__expandable-label">Note</span>
					</Button>
				</>
			)}
			{enablePlayground && (
				<Button
					aria-label="Open playground"
					className="fx-canvas__quick-action fx-canvas__expandable-action fx-canvas__playground-action bg-surface text-foreground hover:bg-surface-secondary"
					onPress={onOpenPlayground}
				>
					<TbPlayerPlay className="fx-canvas__expandable-icon" />
					<span className="fx-canvas__expandable-label">Playground</span>
				</Button>
			)}
			<Button
				aria-label="Diagnostics"
				className={`fx-canvas__quick-action fx-canvas__expandable-action fx-canvas__diagnostics-action bg-surface text-foreground hover:bg-surface-secondary ${isPanelOpen ? "bg-surface-secondary" : ""}`}
				onPress={togglePanel}
			>
				{pending ? (
					<Spinner size="sm" className="fx-canvas__expandable-icon" />
				) : (
					<div className="relative flex items-center justify-center fx-canvas__expandable-icon">
						<TbStethoscope className="w-full h-full" />
						{dot && <span aria-hidden className={`absolute -right-1 -top-1 size-2 rounded-full ${dot}`} />}
					</div>
				)}
				<span className="fx-canvas__expandable-label">Diagnostics</span>
			</Button>
		</div>
	);
}
