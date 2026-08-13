import { useState } from "react";
import { Button, TextField, Label, Input, toast, Spinner } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { projectsQuery } from "@/query/projectsQuery";
import { projectsService } from "@/services/projects";
import { showErrorNotification } from "@/lib/errorNotifier";

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
		</div>
	);
}
