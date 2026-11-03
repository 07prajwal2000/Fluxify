import { Button, Tooltip } from "@fluxify/components";
import { useState } from "react";
import { TbGitCommit, TbHistory } from "react-icons/tb";
import type { CanvasHeaderState } from "@/components/canvas/CanvasWorkbench";
import { SplitButton } from "@/components/common/SplitButton";
import { versionsQuery } from "@/query/versionsQuery";
import type { Version, VersionKind } from "@/services/versions";
import { useCanEditProject } from "@/store/auth";
import { CommitDialog } from "./CommitDialog";
import { DeployDialog } from "./DeployDialog";
import { useVersionTarget } from "./useVersionTarget";
import { versionMenuItem } from "./versionMenuItem";

/**
 * The canvas header's version controls (#738): Commit, with a dot while there is
 * work no version holds, and a menu to the history. The menu lists the versions
 * under it, so one can be promoted from here (#1075). Viewers get the history only.
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
	const [promoting, setPromoting] = useState<Version>();
	// only someone who can promote needs the list
	const { data: history } = versionsQuery.list.useQuery(kind, canEdit ? id : "");
	const versions = history?.versions ?? [];
	const liveVersionNumber = versions.find((v) => v.isProd)?.versionNumber ?? null;
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
							...versions.map((version) =>
								versionMenuItem(version, liveVersionNumber, setPromoting),
							),
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
			{promoting && (
				<DeployDialog
					kind={kind}
					id={id}
					projectId={projectId}
					version={promoting}
					liveVersionNumber={liveVersionNumber}
					onClose={() => setPromoting(undefined)}
				/>
			)}
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
