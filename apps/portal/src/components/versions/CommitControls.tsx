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
 * The version menu has a fixed width, so a long title cannot widen it, and a
 * height of Version history plus five rows: the rest scrolls (#1075). A row is
 * 2.25rem and the gap between rows 0.125rem.
 */
const VERSION_MENU = "w-72 max-w-full max-h-[14.375rem] overflow-y-auto";
/** Version history stays at the top while the versions scroll under it. */
const PINNED = "sticky top-0 z-10 bg-overlay hover:bg-default data-[focused=true]:bg-default";

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
						menuClassName={VERSION_MENU}
						items={[
							{
								id: "history",
								label: "Version history",
								icon: <TbHistory size={16} />,
								onAction: onOpenHistory,
								className: PINNED,
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
