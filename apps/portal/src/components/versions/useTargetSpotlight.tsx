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

/**
 * The target's own spotlight commands (#739): version history, commit, and open
 * in sandbox — plus the dialogs they open. Shared by the route and workflow
 * canvas pages, which pass their own navigation back.
 */
export function useTargetSpotlight({
	kind,
	id,
	projectId,
	name,
	goToHistory,
	openSandbox,
}: {
	kind: VersionKind;
	id: string;
	projectId: string;
	name: string;
	goToHistory: () => void;
	openSandbox: (sandboxId: string) => void;
}) {
	const canEdit = useCanEditProject(projectId);
	const [saveFirst, setSaveFirst] = useState<(() => Promise<boolean>) | undefined>();
	const [committing, setCommitting] = useState(false);
	const [sandboxing, setSandboxing] = useState(false);
	const warnings = useSandboxWarnings({ kind, id, name });

	function commands(canvas: CanvasHeaderState): SpotlightCommand[] {
		const list: SpotlightCommand[] = [
			{
				id: "version-history",
				title: "Go to version history",
				subtitle: "Versions",
				category: "Navigation",
				keywords: ["history", "versions", "revert", "rollback", "production"],
				icon: <TbHistory size={15} />,
				onSelect: goToHistory,
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

	const dialogs = (
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
					onOpen={openSandbox}
				/>
			)}
		</>
	);

	return { commands, dialogs };
}
