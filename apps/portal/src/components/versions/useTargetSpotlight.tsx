import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { TbFlask, TbGitCommit, TbHistory } from "react-icons/tb";
import type { CanvasHeaderState } from "@/components/canvas/CanvasWorkbench";
import type { SpotlightCommand } from "@/components/canvas/spotlight/types";
import {
	OpenInSandboxDialog,
	useSandboxWarnings,
} from "@/components/sandboxes/OpenInSandboxDialog";
import type { VersionKind } from "@/services/versions";
import { useCanEditProject } from "@/store/auth";
import { CommitDialog } from "./CommitDialog";
import { useVersionTarget } from "./useVersionTarget";

/** A page without the canvas has no unsaved edits to save first. */
const NO_CANVAS: CanvasHeaderState = { hasUnsavedChanges: false, saveChanges: async () => true };

/**
 * The spotlight commands for the route or workflow the current page is about
 * (#739): go to version history, commit, and open in sandbox — plus the dialogs
 * they open. Reads the target from the route params, so the same actions appear
 * in the canvas palette and in the spotlight on the Tests, Executions and
 * Versions pages. A page with no target (the project-wide pages) gets none.
 */
export function useTargetSpotlight() {
	const navigate = useNavigate();
	const params = useParams({ strict: false }) as {
		projectId?: string;
		routeId?: string;
		workflowId?: string;
	};
	const projectId = params.projectId ?? "";
	const kind: VersionKind | undefined = params.routeId
		? "route"
		: params.workflowId
			? "workflow"
			: undefined;
	const id = params.routeId ?? params.workflowId ?? "";
	const canEdit = useCanEditProject(projectId);
	const { name } = useVersionTarget(kind ?? "route", id);
	const warnings = useSandboxWarnings({ kind: kind ?? "route", id, name });

	const [saveFirst, setSaveFirst] = useState<(() => Promise<boolean>) | undefined>();
	const [committing, setCommitting] = useState(false);
	const [sandboxing, setSandboxing] = useState(false);

	function commands(canvas: CanvasHeaderState = NO_CANVAS): SpotlightCommand[] {
		if (!kind || !id) return [];
		const list: SpotlightCommand[] = [
			{
				id: "version-history",
				title: "Go to version history",
				subtitle: "Versions",
				category: "Navigation",
				keywords: ["history", "versions", "revert", "rollback", "production"],
				icon: <TbHistory size={15} />,
				onSelect: () =>
					navigate(
						kind === "route"
							? {
									to: "/$projectId/canvas/$routeId/versions",
									params: { projectId, routeId: id },
								}
							: {
									to: "/$projectId/workflow-canvas/$workflowId/versions",
									params: { projectId, workflowId: id },
								},
					),
			},
			{
				id: "commit",
				title: "Commit…",
				subtitle: "Versions",
				category: "Actions",
				keywords: ["commit", "save", "version", "checkpoint"],
				icon: <TbGitCommit size={15} />,
				onSelect: () => {
					// saves unsaved edits first, exactly like the header's Commit (#738)
					setSaveFirst(canvas.hasUnsavedChanges ? () => canvas.saveChanges : undefined);
					setCommitting(true);
				},
			},
		];
		if (canEdit) {
			list.push({
				id: "open-sandbox",
				title: "Open in sandbox",
				subtitle: "Sandbox",
				category: "Actions",
				keywords: ["sandbox", "draft", "test", "copy"],
				icon: <TbFlask size={15} />,
				onSelect: () => setSandboxing(true),
			});
		}
		return list;
	}

	const dialogs =
		kind && id ? (
			<>
				{committing && (
					<CommitDialog
						kind={kind}
						id={id}
						saveFirst={saveFirst}
						onClose={() => {
							setCommitting(false);
							setSaveFirst(undefined);
						}}
					/>
				)}
				{sandboxing && (
					<OpenInSandboxDialog
						open
						projectId={projectId}
						source={{ kind, id, name }}
						warnings={warnings}
						onOpenChange={(open) => !open && setSandboxing(false)}
						onOpen={(sandboxId) =>
							navigate({
								to: "/$projectId/sandbox-canvas/$sandboxId",
								params: { projectId, sandboxId },
							})
						}
					/>
				)}
			</>
		) : null;

	return { commands, dialogs };
}
