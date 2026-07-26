import {
	createFileRoute,
	Outlet,
	redirect,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import {
	TbActivity,
	TbArrowLeft,
	TbBox,
	TbCloudCog,
	TbLayoutGridFilled,
	TbSettings,
	TbSparkles,
	TbSquareKey,
	TbStack2,
} from "react-icons/tb";
import { cn } from "@fluxify/components";
import { authClient } from "@/lib/auth";
import { projectsQuery } from "@/query/projectsQuery";
import { ProfileNav } from "@/components/home/ProfileNav";

const NAV = [
	{ key: "ai", label: "Fluxify AI", to: "/$projectId/ai", icon: TbSparkles },
	{ key: "routes", label: "Routes", to: "/$projectId/routes", icon: TbStack2 },
	{ key: "executions", label: "Executions", to: "/$projectId/executions", icon: TbActivity },
	{ key: "integrations", label: "Integrations", to: "/$projectId/integrations", icon: TbCloudCog },
	{ key: "app-config", label: "App config", to: "/$projectId/app-config", icon: TbSquareKey },
	{ key: "custom-blocks", label: "Custom Blocks", to: "/$projectId/custom-blocks", icon: TbBox },
] as const;

export const Route = createFileRoute("/_authed/$projectId")({
	beforeLoad: async ({ params }) => {
		const session = await authClient.getSession();
		const acl = (session.data as { acl?: { projectId: string }[] } | null)?.acl ?? [];
		const isAdmin = (session.data?.user as { isSystemAdmin?: boolean } | undefined)?.isSystemAdmin;
		const hasAccess =
			isAdmin || acl.some((a) => a.projectId === params.projectId || a.projectId === "*");
		if (!hasAccess) throw redirect({ to: "/" });
	},
	component: ProjectLayout,
});

function ProjectLayout() {
	const { projectId } = Route.useParams();
	const navigate = useNavigate();
	const location = useLocation();
	const active = NAV.find((n) => location.pathname.includes(`/${n.key}`))?.key ?? "routes";

	const { data } = projectsQuery.getAll.useQuery({ page: 1, perPage: 50 });
	const projectName =
		data?.data?.find((p: { id: string }) => p.id === projectId)?.name ?? "Project";

	return (
		<div className="flex h-screen w-screen flex-col bg-background text-foreground">
			<header className="flex h-[52px] items-center justify-between border-b border-border bg-background-secondary px-4">
				<div className="flex items-center gap-3">
					<div className="flex size-7 items-center justify-center rounded-lg bg-accent text-accent-foreground shadow-[0_0_16px_var(--accent-soft)]">
						<TbLayoutGridFilled size={16} />
					</div>
					<span className="text-sm font-bold tracking-tight">FLUXIFY</span>
					<div className="ml-1 flex items-center gap-1.5 border-l border-border pl-3">
						<span className="text-sm text-muted">{projectName}</span>
						<button
							type="button"
							aria-label="Project settings"
							onClick={() =>
								navigate({ to: "/$projectId/settings", params: { projectId } })
							}
							className="inline-flex size-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-white/5 hover:text-foreground"
						>
							<TbSettings size={15} />
						</button>
					</div>
				</div>
				<ProfileNav />
			</header>

			<div className="flex min-h-0 flex-1">
				<aside className="flex w-[220px] flex-col justify-between border-r border-border bg-background-secondary p-3">
					<nav className="flex flex-col gap-0.5">
						{NAV.map((item) => {
							const isActive = active === item.key;
							return (
								<button
									key={item.key}
									type="button"
									onClick={() => navigate({ to: item.to, params: { projectId } })}
									className={cn(
										"flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
										isActive
											? "bg-white/5 font-medium text-foreground"
											: "text-muted hover:bg-white/[0.03] hover:text-foreground",
									)}
								>
									<item.icon
										size={18}
										className={isActive ? "text-accent" : ""}
									/>
									{item.label}
								</button>
							);
						})}
					</nav>

					<button
						type="button"
						onClick={() => navigate({ to: "/" })}
						className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-white/[0.03] hover:text-foreground"
					>
						<TbArrowLeft size={18} /> Back to projects
					</button>
				</aside>

				<main className="min-w-0 flex-1 overflow-y-auto p-6">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
