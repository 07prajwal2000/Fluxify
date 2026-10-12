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

/** The kind and id the current page is about, from whichever param is present. */
function readTarget(params: {
	routeId?: string;
	workflowId?: string;
	blockId?: string;
	middlewareId?: string;
}): { kind: VersionKind; id: string } | undefined {
	if (params.routeId) return { kind: "route", id: params.routeId };
	if (params.workflowId) return { kind: "workflow", id: params.workflowId };
	if (params.blockId) return { kind: "custom_block", id: params.blockId };
	if (params.middlewareId) return { kind: "middleware", id: params.middlewareId };
	return undefined;
}

/** The version history route and its params, per kind (#738, #740). */
function historyNav(kind: VersionKind, projectId: string, id: string) {
	if (kind === "route")
		return {
			to: "/$projectId/canvas/$routeId/versions",
			params: { projectId, routeId: id },
		};
	if (kind === "workflow")
		return {
			to: "/$projectId/workflow-canvas/$workflowId/versions",
			params: { projectId, workflowId: id },
		};
	if (kind === "custom_block")
		return {
			to: "/$projectId/custom-block-canvas/$blockId/versions",
			params: { projectId, blockId: id },
		};
	return {
		to: "/$projectId/middlewares/$middlewareId/versions",
		params: { projectId, middlewareId: id },
	};
}

/**
 * The spotlight commands for the target the current page is about (#739, #740):
 * go to version history and commit — plus Open in sandbox, which is a route's and
 * a workflow's only. Reads the target from the route params, so the same actions
 * appear in the canvas palette and in the spotlight on the sibling pages.
 */
export function useTargetSpotlight() {
	const navigate = useNavigate();
	const params = useParams({ strict: false }) as {
		projectId?: string;
		routeId?: string;
		workflowId?: string;
		blockId?: string;
		middlewareId?: string;
	};
	const projectId = params.projectId ?? "";
	const target = readTarget(params);
	const kind = target?.kind;
	const id = target?.id ?? "";
	const canEdit = useCanEditProject(projectId);
	const { name } = useVersionTarget(kind ?? "route", id);
	// Open in sandbox copies a canvas into a sandbox; a block has no canvas to copy
	const sandboxable = kind === "route" || kind === "workflow";
	const warnings = useSandboxWarnings({
		kind: kind === "workflow" ? "workflow" : "route",
		id,
		name,
	});

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
				onSelect: () => navigate(historyNav(kind, projectId, id) as never),
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
		if (canEdit && sandboxable) {
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
				{sandboxing && sandboxable && (
					<OpenInSandboxDialog
						open
						projectId={projectId}
						source={{ kind: kind === "workflow" ? "workflow" : "route", id, name }}
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
