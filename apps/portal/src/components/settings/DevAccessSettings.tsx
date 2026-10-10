import { Button, toast } from "@fluxify/components";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { TbCopy, TbRefresh } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { projectDevTokenService } from "@/services/projectDevToken";
import { useCanEditProject, useIsProjectAdmin } from "@/store/auth";

const HEADER = "x-fluxify-dev-token";
const queryKey = (projectId: string) => ["project-dev-token", projectId];

/** Shows the shape, never the secret: the real token only ever goes to the clipboard. */
const MASKED = "fxd_••••••••••••••••••••••••••••";

export function DevAccessSettings({ projectId }: { projectId: string }) {
	const canView = useCanEditProject(projectId);
	const canRotate = useIsProjectAdmin(projectId);
	const client = useQueryClient();
	const [confirming, setConfirming] = useState(false);

	const { data } = useQuery({
		queryKey: queryKey(projectId),
		queryFn: () => projectDevTokenService.get(projectId),
		enabled: canView,
		refetchOnWindowFocus: false,
	});
	const rotate = useMutation({
		mutationFn: () => projectDevTokenService.rotate(projectId),
		onSuccess: (next) => {
			client.setQueryData(queryKey(projectId), next);
			setConfirming(false);
			toast.success("Token rotated. The old one no longer works.");
		},
		onError: (e) => showErrorNotification(e as Error),
	});

	// the server refuses a viewer too; this only keeps the section out of sight
	if (!canView) return null;

	async function copy() {
		if (!data) return;
		try {
			await navigator.clipboard.writeText(data.token);
			toast.success("Token copied");
		} catch {
			toast.danger("Couldn't copy the token");
		}
	}

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">Development access</h1>
				<p className="text-sm text-muted">
					Call this project's development routes and sandboxes from Postman, curl or a frontend.
					Send the token in the <code className="text-foreground">{HEADER}</code> header. It never
					opens production.
				</p>
			</div>

			<div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-surface-secondary p-4">
				<div className="flex min-w-0 flex-col gap-1">
					<h3 className="font-medium text-foreground">Access token</h3>
					<code className="truncate text-sm text-muted">{MASKED}</code>
				</div>
				<div className="flex shrink-0 gap-2">
					<Button variant="secondary" isDisabled={!data} onPress={copy}>
						<TbCopy size={16} /> Copy token
					</Button>
					{canRotate && (
						<Button variant="danger-soft" onPress={() => setConfirming(true)}>
							<TbRefresh size={16} /> Rotate token
						</Button>
					)}
				</div>
			</div>

			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title="Rotate the development token?"
				confirmText="Rotate token"
				danger
				pending={rotate.isPending}
				onConfirm={() => rotate.mutate()}
			>
				The current token stops working right away. Anything that uses it, such as Postman, a script
				or a frontend, must be updated with the new one.
			</ConfirmDialog>
		</div>
	);
}
