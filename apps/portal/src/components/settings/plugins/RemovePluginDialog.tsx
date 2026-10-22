import { toast } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { DeleteBlocked } from "@/components/versions/DeleteBlocked";
import { showErrorNotification } from "@/lib/errorNotifier";
import { pluginsQuery } from "@/query/pluginsQuery";
import { type Reference, referencesFromDeleteError } from "@/services/references";

type IntegrationRef = { id: string; name: string; group?: string; variant?: string };

function integrationsFromDeleteError(
	error: unknown,
): { message: string; integrations: IntegrationRef[] } | undefined {
	const response = (error as { response?: { data?: unknown } } | undefined)?.response;
	const data = response?.data as
		| { message?: string; details?: { integrations?: IntegrationRef[] } }
		| undefined;
	if (
		data?.details &&
		Array.isArray(data.details.integrations) &&
		data.details.integrations.length > 0
	) {
		return {
			message: typeof data.message === "string" ? data.message : "Still provides integrations",
			integrations: data.details.integrations,
		};
	}
	return undefined;
}

/**
 * Removing a plugin is refused (409) while a route, workflow or custom block
 * uses one of its blocks; the dialog stays open and lists them as links.
 */
export function RemovePluginDialog({
	projectId,
	name,
	open,
	onOpenChange,
	onRemoved,
}: {
	projectId: string;
	name: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onRemoved: () => void;
}) {
	const remove = pluginsQuery.remove.useMutation(projectId);
	const [blocked, setBlocked] = useState<{ message: string; references: Reference[] }>();
	const [blockedIntegrations, setBlockedIntegrations] = useState<{
		message: string;
		integrations: IntegrationRef[];
	}>();

	function confirm() {
		remove.mutate(name, {
			onSuccess: () => {
				toast.success(`${name} removed`);
				onOpenChange(false);
				onRemoved();
			},
			onError: (e) => {
				const conflict = referencesFromDeleteError(e);
				if (conflict) {
					setBlocked(conflict);
					return;
				}
				const integrationConflict = integrationsFromDeleteError(e);
				if (integrationConflict) {
					setBlockedIntegrations(integrationConflict);
					return;
				}
				showErrorNotification(e);
			},
		});
	}

	return (
		<ConfirmDialog
			open={open}
			onOpenChange={(o) => {
				if (!o) {
					setBlocked(undefined);
					setBlockedIntegrations(undefined);
				}
				onOpenChange(o);
			}}
			title={`Remove ${name}?`}
			confirmText="Remove"
			danger
			pending={remove.isPending}
			onConfirm={confirm}
		>
			Its blocks stop loading on every worker, which restart gracefully. Routes, workflows and
			custom blocks that use it must drop it first.
			{blocked && (
				<DeleteBlocked
					message={blocked.message}
					references={blocked.references}
					projectId={projectId}
				/>
			)}
			{blockedIntegrations && (
				<div
					role="alert"
					className="mt-3 flex flex-col gap-2 rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs"
				>
					<p className="font-medium text-danger">{blockedIntegrations.message}</p>
					<ul className="flex flex-col gap-1 pl-4 list-disc text-foreground">
						{blockedIntegrations.integrations.map((item) => (
							<li key={item.id}>
								<Link
									to="/$projectId/integrations/$integrationId"
									params={{ projectId, integrationId: item.id }}
									className="text-accent underline font-medium hover:text-accent/80"
								>
									{item.name}
								</Link>
								{(item.group || item.variant) && (
									<span className="text-muted">
										{" "}
										({[item.group, item.variant].filter(Boolean).join("/")})
									</span>
								)}
							</li>
						))}
					</ul>
				</div>
			)}
		</ConfirmDialog>
	);
}
