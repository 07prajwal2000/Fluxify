import { Card } from "@fluxify/components";
import { useNavigate } from "@tanstack/react-router";
import { getTimeAgo } from "@/lib/datetime";
import { APP_ROUTES } from "@/constants/routes";

type ProjectCardProps = {
	id: string;
	name: string;
	updatedAt: string | Date;
	createdAt: string | Date;
};

export function ProjectCard({ id, name, updatedAt, createdAt }: ProjectCardProps) {
	const navigate = useNavigate();

	return (
		<Card
			className="cursor-pointer overflow-hidden border border-border p-0 transition-colors hover:border-accent"
			// ponytail: raw project path; cast until project routes are typed
			onClick={() => navigate({ to: APP_ROUTES.PROJECT_ROUTES(id) as "/" })}
		>
			<div className="h-24 bg-accent-soft" />
			<div className="flex flex-col gap-1 bg-background-secondary p-4">
				<span className="text-base font-medium text-foreground">{name}</span>
				<span className="text-xs text-muted">Updated {getTimeAgo(updatedAt)}</span>
				<span className="text-xs text-muted">Created {getTimeAgo(createdAt)}</span>
			</div>
		</Card>
	);
}
