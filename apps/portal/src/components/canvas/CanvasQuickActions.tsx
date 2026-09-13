import { Button } from "@fluxify/components";
import { TbNote, TbPlayerPlay, TbPlus } from "react-icons/tb";

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
		</div>
	);
}
