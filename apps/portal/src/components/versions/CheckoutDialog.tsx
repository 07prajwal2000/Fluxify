import { Input, Label, TextField, toast } from "@fluxify/components";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { versionsQuery } from "@/query/versionsQuery";
import type { Version, VersionKind } from "@/services/versions";

/**
 * Brings a version back as the working copy (#738). Uncommitted work is saved
 * as a new version first, so the dialog asks what to call it. Mounted only
 * while open, so the title starts from its default every time.
 */
export function CheckoutDialog({
	kind,
	id,
	version,
	uncommitted,
	onClose,
	onCheckedOut,
}: {
	kind: VersionKind;
	id: string;
	version: Version;
	/** the working copy holds work no version does */
	uncommitted: boolean;
	onClose: () => void;
	/** the working copy is the version now */
	onCheckedOut: () => void;
}) {
	const [title, setTitle] = useState(`Saved before checking out v${version.versionNumber}`);
	const checkout = versionsQuery.checkout.mutation(kind, id);

	function confirm() {
		checkout.mutate(
			// blank falls back to the same default on the server
			{ versionId: version.id, title: uncommitted ? title.trim() || undefined : undefined },
			{
				onSuccess: (result) => {
					toast.success(`Checked out v${version.versionNumber}`);
					if (result.savedVersion)
						toast.success(`Saved your work as v${result.savedVersion.versionNumber}`);
					for (const warning of result.warnings) toast.warning(warning);
					onClose();
					onCheckedOut();
				},
				onError: (error) => showErrorNotification(error),
			},
		);
	}

	return (
		<ConfirmDialog
			open
			onOpenChange={(open) => !open && onClose()}
			title={`Check out v${version.versionNumber}`}
			confirmText="Check out"
			pending={checkout.isPending}
			onConfirm={confirm}
		>
			<p>
				This makes v{version.versionNumber}, {version.title}, the current {kind}. Its blocks and
				settings replace what is there now.
			</p>
			{uncommitted && (
				<>
					<p className="mt-2">
						You have changes no version holds. They are saved as a new version first, so nothing is
						lost.
					</p>
					<TextField className="mt-3" value={title} onChange={setTitle} maxLength={255}>
						<Label>Title for the saved version</Label>
						<Input />
					</TextField>
				</>
			)}
		</ConfirmDialog>
	);
}
