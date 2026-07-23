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
	TbSettings,
	TbSparkles,
	TbSquareKey,
	TbStack2,
} from "react-icons/tb";
import { Button, ListBox } from "@fluxify/components";
import { authClient } from "@/lib/auth";
import { projectsQuery } from "@/query/projectsQuery";
import { ProfileNav } from "@/components/home/ProfileNav";

const logo = `${import.meta.env.BASE_URL}logo_title.webp`;

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
			<header className="flex items-center justify-between border-b border-border px-5 py-3">
				<div className="flex items-center gap-4">
					<img src={logo} alt="Fluxify" className="h-7 object-contain" />
					<div className="flex items-center gap-2 border-l border-border pl-4">
						<span className="font-medium">{projectName}</span>
						<Button
							isIconOnly
							variant="ghost"
							aria-label="Project settings"
							onPress={() =>
								navigate({ to: "/$projectId/settings", params: { projectId } })
							}
						>
							<TbSettings size={16} />
						</Button>
					</div>
				</div>
				<ProfileNav />
			</header>

			<div className="flex min-h-0 flex-1">
				<aside className="flex w-60 flex-col justify-between border-r border-border p-3">
					<ListBox
						aria-label="Project sections"
						selectionMode="single"
						selectedKeys={new Set([active])}
						onSelectionChange={(keys) => {
							const key = [...(keys as Set<string>)][0];
							const item = NAV.find((n) => n.key === key);
							if (item) navigate({ to: item.to, params: { projectId } });
						}}
					>
						{NAV.map((item) => (
							<ListBox.Item key={item.key} id={item.key} textValue={item.label}>
								<span className="flex items-center gap-2.5">
									<item.icon size={18} />
									{item.label}
								</span>
							</ListBox.Item>
						))}
					</ListBox>

					<Button variant="ghost" onPress={() => navigate({ to: "/" })}>
						<TbArrowLeft size={18} /> Back to projects
					</Button>
				</aside>

				<main className="min-w-0 flex-1 overflow-y-auto p-6">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
