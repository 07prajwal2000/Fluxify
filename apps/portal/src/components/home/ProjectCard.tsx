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
			// ponytail: raw project path; cast until project routes are typed
			onClick={() => navigate({ to: APP_ROUTES.PROJECT_ROUTES(id) as "/" })}
			className="h-full cursor-pointer transition-colors hover:border-accent"
		>
			<Card.Header>
				<Card.Title className="truncate">{name}</Card.Title>
				<Card.Description>Updated {getTimeAgo(updatedAt)}</Card.Description>
			</Card.Header>
			<Card.Content>
				<span className="text-xs text-muted">Created {getTimeAgo(createdAt)}</span>
			</Card.Content>
		</Card>
	);
}
