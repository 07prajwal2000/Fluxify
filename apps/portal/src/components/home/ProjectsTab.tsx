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
		<div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
			{data?.data?.map((project) => (
				<ProjectCard
					key={project.id}
					id={project.id}
					name={project.name!}
					updatedAt={project.updatedAt}
					createdAt={project.createdAt}
				/>
			))}
			{userData?.isSystemAdmin && <NewProjectCard />}
		</div>
	);
}

function NewProjectCard() {
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
				<Card className="flex h-full min-h-40 cursor-pointer flex-col items-center justify-center gap-2 border border-dashed border-border bg-background-secondary text-muted transition-colors hover:border-accent hover:text-accent">
					<TbPlus size={32} />
					<span>New Project</span>
				</Card>
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
