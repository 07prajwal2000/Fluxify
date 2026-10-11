import { Button, Tooltip } from "@fluxify/components";
import { useState } from "react";
import { TbGitCommit, TbHistory } from "react-icons/tb";
import type { CanvasHeaderState } from "@/components/canvas/CanvasWorkbench";
import { SplitButton } from "@/components/common/SplitButton";
import type { VersionKind } from "@/services/versions";
import { useCanEditProject } from "@/store/auth";
import { CommitDialog } from "./CommitDialog";
import { useVersionTarget } from "./useVersionTarget";

/**
 * The canvas header's version controls (#738): Commit, with a dot while there is
 * work no version holds, and a menu to the history. Viewers get the history only.
 */
export function CommitControls({
	kind,
	id,
	projectId,
	canvas,
	onOpenHistory,
}: {
	kind: VersionKind;
	id: string;
	projectId: string;
	canvas: CanvasHeaderState;
	onOpenHistory: () => void;
}) {
	const canEdit = useCanEditProject(projectId);
	const { uncommitted } = useVersionTarget(kind, id);
	const [committing, setCommitting] = useState(false);
	// edits still on the canvas are work too: they become uncommitted once saved
	const hasWork = uncommitted || canvas.hasUnsavedChanges;

	if (!canEdit) {
		return (
			<Button variant="outline" onPress={onOpenHistory}>
				<TbHistory size={16} /> Version history
			</Button>
		);
	}

	return (
		<>
			<Tooltip isDisabled={hasWork}>
				{/* a disabled button takes no hover, so the tooltip sits on its wrapper */}
				<Tooltip.Trigger role="group" aria-label="Commit">
					<SplitButton
						isDisabled={!hasWork}
						onPress={() => setCommitting(true)}
						menuLabel="Version options"
						items={[
							{
								id: "history",
								label: "Version history",
								icon: <TbHistory size={16} />,
								onAction: onOpenHistory,
							},
						]}
					>
						<TbGitCommit size={16} /> Commit
						{hasWork && (
							<span
								role="img"
								aria-label="Uncommitted changes"
								className="size-2 rounded-full bg-warning"
							/>
						)}
					</SplitButton>
				</Tooltip.Trigger>
				<Tooltip.Content>Nothing to commit</Tooltip.Content>
			</Tooltip>
			{committing && (
				<CommitDialog
					kind={kind}
					id={id}
					// edits still on the canvas are saved first; the dialog asks for the title meanwhile
					saveFirst={canvas.hasUnsavedChanges ? canvas.saveChanges : undefined}
					onClose={() => setCommitting(false)}
				/>
			)}
		</>
	);
}
