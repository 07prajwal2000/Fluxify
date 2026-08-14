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
						variant="ghost"
						className="fx-canvas__quick-action fx-canvas__expandable-action fx-canvas__add-block-action"
						onPress={onOpenBlockPicker}
					>
						<TbPlus className="fx-canvas__expandable-icon" />
						<span className="fx-canvas__expandable-label">Add New Block</span>
					</Button>
					<Button
						aria-label="Add note"
						variant="ghost"
						className="fx-canvas__quick-action fx-canvas__expandable-action fx-canvas__note-action"
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
					variant="ghost"
					className="fx-canvas__quick-action fx-canvas__expandable-action fx-canvas__playground-action"
					onPress={onOpenPlayground}
				>
					<TbPlayerPlay className="fx-canvas__expandable-icon" />
					<span className="fx-canvas__expandable-label">Playground</span>
				</Button>
			)}
		</div>
	);
}
