import { useEffect, useState } from "react";
import { Button, TextField, Label, Input, toast, Spinner } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { projectsQuery } from "@/query/projectsQuery";
import { projectsService } from "@/services/projects";
import { showErrorNotification } from "@/lib/errorNotifier";
import { projectSettingsKeysQuery } from "@/query/projectSettingsKeysQuery";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import type { RequestBodySchema } from "@fluxify/server/src/api/v1/projects/settings/keys/upsert/dto";
import { SubdomainField, subdomainError, useBaseDomain } from "./SubdomainField";

export function GeneralSettings({ projectId }: { projectId: string }) {
	// Match the ProjectsTab query to hit the cache immediately
	const query = { page: 1, perPage: 50 };
	const { data, isLoading } = projectsQuery.getAll.useQuery(query);
	
	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}

	const project = data?.data?.find((p: any) => p.id === projectId);

	if (!project) {
		return (
			<div className="py-16 text-center text-muted">
				Project not found.
			</div>
		);
	}

	return <GeneralSettingsForm projectId={projectId} project={project} query={query} />;
}

function GeneralSettingsForm({ 
	projectId, 
	project, 
	query 
}: { 
	projectId: string; 
	project: any; 
	query: any; 
}) {
	const client = useQueryClient();
	const [name, setName] = useState(project.name ?? "");
	const [description, setDescription] = useState(project.description ?? "");
	const [saving, setSaving] = useState(false);

	async function onSave(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		try {
			await projectsService.update(projectId, { name, description });
			projectsQuery.getAll.invalidate(query, client);
			toast.success("Project updated");
		} catch (err) {
			showErrorNotification(err as Error);
		} finally {
			setSaving(false);
		}
	}

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h2 className="text-xl font-semibold tracking-tight">General</h2>
				<p className="text-sm text-muted">Manage your project name and description.</p>
			</div>

			<form onSubmit={onSave} className="flex flex-col gap-4">
				<TextField isRequired value={name} onChange={setName}>
					<Label>Project name</Label>
					<Input />
				</TextField>

				<TextField value={description} onChange={setDescription}>
					<Label>Description</Label>
					<Input />
				</TextField>

				<div className="mt-2 flex justify-end">
					<Button type="submit" variant="primary" isPending={saving}>
						Save changes
					</Button>
				</div>
			</form>

			<ApiAddressSettings projectId={projectId} />
		</div>
	);
}

const SUBDOMAIN_KEY = "settings.routing.subdomain";

/**
 * Changing the subdomain moves every route in the project at once, so anything
 * still calling the old address starts getting 404s. Always confirmed first.
 */
function ApiAddressSettings({ projectId }: { projectId: string }) {
	const { data } = projectSettingsKeysQuery.getAll.useQuery(projectId);
	const upsert = projectSettingsKeysQuery.upsert.useMutation(projectId);
	const baseDomain = useBaseDomain();
	const saved = ((data ?? {}) as Record<string, string>)[SUBDOMAIN_KEY] ?? "";
	const [subdomain, setSubdomain] = useState(saved);
	const [confirming, setConfirming] = useState(false);

	useEffect(() => setSubdomain(saved), [saved]);

	const address = (value: string) => (value ? `${value}.${baseDomain}` : baseDomain);

	function save() {
		upsert.mutate({ key: SUBDOMAIN_KEY, value: subdomain } as RequestBodySchema, {
			onSuccess: () => {
				setConfirming(false);
				toast.success("API address saved");
			},
			onError: (error) => {
				setConfirming(false);
				showErrorNotification(error as Error);
			},
		});
	}

	return (
		<div className="flex flex-col gap-4 border-t border-border pt-6">
			<div>
				<h3 className="text-base font-semibold tracking-tight">API address</h3>
				<p className="text-sm text-muted">
					Currently served on <code>{address(saved)}</code>
					{saved ? "" : ", shared with other projects that have no subdomain"}.
				</p>
			</div>

			<SubdomainField value={subdomain} onChange={setSubdomain} />

			<div className="flex justify-end">
				<Button
					variant="primary"
					isDisabled={subdomain === saved || !!subdomainError(subdomain)}
					onPress={() => setConfirming(true)}
				>
					Change address
				</Button>
			</div>

			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title="Move this project's APIs?"
				confirmText="Move APIs"
				danger
				pending={upsert.isPending}
				onConfirm={save}
			>
				Every route moves from <code>{address(saved)}</code> to <code>{address(subdomain)}</code>{" "}
				right away. Anything still calling the old address gets a 404, so update your clients and DNS
				first.
			</ConfirmDialog>
		</div>
	);
}
