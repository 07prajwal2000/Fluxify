import { useState } from "react";
import {
	Button,
	Card,
	Modal,
	Spinner,
	TextField,
	Label,
	Input,
	FieldError,
	toast,
} from "@fluxify/components";
import { TbPlus } from "react-icons/tb";
import { useQueryClient } from "@tanstack/react-query";
import { projectsQuery } from "@/query/projectsQuery";
import { projectsService } from "@/services/projects";
import { showErrorNotification } from "@/lib/errorNotifier";
import { useAuthStore } from "@/store/auth";
import { ProjectCard } from "./ProjectCard";

export function ProjectsTab() {
	const client = useQueryClient();
	const { userData } = useAuthStore();
	const query = { page: 1, perPage: 50 };
	const { data, isLoading, isError } = projectsQuery.getAll.useQuery(query);

	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}

	if (isError) {
		return (
			<div className="flex flex-col items-center gap-3 py-16 text-muted">
				<p>Couldn't load projects.</p>
				<Button
					variant="outline"
					onPress={() => projectsQuery.getAll.invalidate(query, client)}
				>
					Retry
				</Button>
			</div>
		);
	}

	return (
		<div className="pt-4">
			<div className="mb-8 flex items-center justify-between">
				<div>
					<h1 className="text-3xl font-bold tracking-tight text-foreground">Projects</h1>
					<p className="mt-1 text-sm text-muted-foreground">Build and manage your low-code applications</p>
				</div>
				{userData?.isSystemAdmin && <NewProjectButton />}
			</div>
			<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
				{data?.data?.map((project: any) => (
					<ProjectCard
						key={project.id}
						id={project.id}
						name={project.name!}
						description={project.description}
						totalUsers={project.totalUsers}
						totalRoutes={project.totalRoutes}
						updatedAt={project.updatedAt}
						createdAt={project.createdAt}
					/>
				))}
			</div>
		</div>
	);
}

function NewProjectButton() {
	const client = useQueryClient();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [error, setError] = useState<string>();
	const [saving, setSaving] = useState(false);

	async function onSubmit(e: React.FormEvent) {
		e.preventDefault();
		setSaving(true);
		setError(undefined);
		try {
			await projectsService.create({ name });
			projectsQuery.invalidateAll(client);
			setOpen(false);
			setName("");
			toast.success("Project created");
		} catch (err) {
			showErrorNotification(err as Error);
			setError((err as Error).message);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Modal isOpen={open} onOpenChange={setOpen}>
			<Modal.Trigger>
				<button className="flex items-center gap-2 rounded-md bg-[#ccff00] px-4 py-2 text-sm font-medium text-black transition-colors hover:bg-[#b3e600]">
					<TbPlus className="h-4 w-4" />
					New Project
				</button>
			</Modal.Trigger>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Create a project</Modal.Heading>
							<p className="mt-1 text-sm text-muted">
								Give it a name to get started — you can rename it later.
							</p>
						</Modal.Header>
						<form onSubmit={onSubmit}>
							<Modal.Body>
								<TextField
									isRequired
									value={name}
									onChange={setName}
									isInvalid={!!error}
								>
									<Label>Project name</Label>
									<Input placeholder="My API project" autoFocus />
									<FieldError>{error}</FieldError>
								</TextField>
							</Modal.Body>
							<Modal.Footer>
								<Button
									type="button"
									variant="ghost"
									onPress={() => setOpen(false)}
								>
									Cancel
								</Button>
								<Button type="submit" variant="primary" isPending={saving}>
									Create project
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
