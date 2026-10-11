import { useState } from "react";
import { TbFlask, TbSettings } from "react-icons/tb";
import { SplitButton } from "@/components/common/SplitButton";
import { useCanEditProject } from "@/store/auth";
import { OpenInSandboxDialog, useSandboxWarnings } from "./OpenInSandboxDialog";
import type { SandboxSource } from "./openInSandbox";

/**
 * A route's or workflow's Settings button, with "Open in sandbox" in the menu
 * beside it (#752). The copy always asks first, and says what does not come along.
 * Sandboxes are for creators and above, so a viewer gets Settings alone.
 */
export function SettingsSplitButton({
	projectId,
	source,
	onOpenSettings,
	onOpenSandbox,
}: {
	projectId: string;
	source: SandboxSource;
	onOpenSettings: () => void;
	/** the new sandbox is saved: open it */
	onOpenSandbox: (sandboxId: string) => void;
}) {
	const canEdit = useCanEditProject(projectId);
	const warnings = useSandboxWarnings(source);
	const [confirming, setConfirming] = useState(false);

	return (
		<>
			<SplitButton
				onPress={onOpenSettings}
				menuLabel="Settings options"
				items={
					canEdit
						? [
								{
									id: "sandbox",
									label: "Open in sandbox",
									icon: <TbFlask size={16} />,
									onAction: () => setConfirming(true),
								},
							]
						: []
				}
			>
				<TbSettings size={16} /> Settings
			</SplitButton>
			{confirming && (
				<OpenInSandboxDialog
					open
					projectId={projectId}
					source={source}
					warnings={warnings}
					onOpenChange={setConfirming}
					onOpen={onOpenSandbox}
				/>
			)}
		</>
	);
}
