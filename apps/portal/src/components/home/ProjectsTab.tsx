import { Button, Spinner } from "@fluxify/components";
import { TbPlus } from "react-icons/tb";
import { useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { projectsQuery } from "@/query/projectsQuery";
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
	const navigate = useNavigate();

	return (
		<Button variant="primary" onPress={() => navigate({ to: "/projects/new" })}>
			<TbPlus className="h-4 w-4" />
			New Project
		</Button>
	);
}
