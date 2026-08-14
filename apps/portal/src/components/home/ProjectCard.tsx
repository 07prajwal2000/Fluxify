import { Button, Tooltip } from "@fluxify/components";
import { useNavigate } from "@tanstack/react-router";
import { APP_ROUTES } from "@/constants/routes";
import { TbUsers, TbHierarchy, TbSettings } from "react-icons/tb";

type ProjectCardProps = {
	id: string;
	name: string;
	description?: string | null;
	totalUsers?: number;
	totalRoutes?: number;
	updatedAt: string | Date;
	createdAt: string | Date;
};

function formatQuantity(num: number) {
	if (num >= 1000) {
		return (num / 1000).toFixed(num % 1000 === 0 ? 0 : 1) + 'K';
	}
	return num.toString();
}

export function ProjectCard({ id, name, description, totalUsers, totalRoutes, updatedAt, createdAt }: ProjectCardProps) {
	const navigate = useNavigate();

	const initials = name
		.split(' ')
		.map(word => word[0])
		.join('')
		.substring(0, 2)
		.toUpperCase();

	const usersCount = totalUsers ?? 0;
	const routesCount = totalRoutes ?? 0;

	return (
		<div
			role="button"
			tabIndex={0}
			onClick={() => navigate({ to: APP_ROUTES.PROJECT_ROUTES(id) as "/" })}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					navigate({ to: APP_ROUTES.PROJECT_ROUTES(id) as "/" });
				}
			}}
			className="group relative flex cursor-pointer flex-col justify-between overflow-hidden rounded-xl border border-border bg-background-secondary transition-all duration-300 hover:scale-[1.01] hover:border-accent"
		>
			<div className="flex flex-col p-5">
				<div className="flex items-start justify-between gap-2">
					<div className="flex items-center gap-3 min-w-0">
						<div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-sm font-bold text-foreground shadow-sm">
							{initials}
						</div>
						<div className="flex flex-col min-w-0">
							<span className="truncate text-base font-semibold text-foreground">{name}</span>
						</div>
					</div>
					
					<Tooltip>
						<Button
							type="button"
							isIconOnly
							size="sm"
							variant="ghost"
							aria-label="Settings"
							className="shrink-0 text-muted hover:text-foreground opacity-0 transition-opacity duration-200 group-hover:opacity-100 focus-visible:opacity-100"
							onClick={(e) => {
								e.stopPropagation();
							}}
							onKeyDown={(e) => {
								e.stopPropagation();
							}}
							onPress={() => {
								navigate({ to: APP_ROUTES.PROJECT_SETTINGS(id) as "/" });
							}}
						>
							<TbSettings size={18} />
						</Button>
						<Tooltip.Content>Settings</Tooltip.Content>
					</Tooltip>
				</div>
				
				<div className="mt-4 text-sm text-muted">
					{description ? (
						<p className="truncate">{description}</p>
					) : (
						<p className="truncate italic text-muted">no description</p>
					)}
				</div>
			</div>

			<div className="flex items-center gap-5 border-t border-border/50 px-5 py-3">
				<div className="flex items-center gap-1.5 text-muted">
					<TbUsers className="h-4 w-4" />
					<span className="text-xs font-medium">{formatQuantity(usersCount)}</span>
				</div>
				<div className="flex items-center gap-1.5 text-muted">
					<TbHierarchy className="h-4 w-4" />
					<span className="text-xs font-medium">{formatQuantity(routesCount)}</span>
				</div>
			</div>
		</div>
	);
}
