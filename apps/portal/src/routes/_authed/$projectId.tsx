import {
	createFileRoute,
	Outlet,
	redirect,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import {
	TbActivity,
	TbAdjustmentsHorizontal,
	TbArrowLeft,
	TbBox,
	TbChevronDown,
	TbCloudCog,
	TbLayoutGridFilled,
	TbSparkles,
	TbSquareKey,
	TbStack2,
} from "react-icons/tb";
import { cn } from "@fluxify/components";
import { authClient } from "@/lib/auth";
import { useAuthStore } from "@/store/auth";

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
	const { userData } = useAuthStore();
	const active = NAV.find((n) => location.pathname.includes(`/${n.key}`))?.key ?? "routes";

	const initials = userData?.name
		? userData.name
				.split(" ")
				.map((n) => n[0])
				.join("")
				.toUpperCase()
				.slice(0, 2)
		: "AD";

	return (
		<div className="flex h-screen w-screen flex-col bg-[#07080A] text-foreground font-sans antialiased">
			{/* Top Header */}
			<header className="flex h-[56px] items-center justify-between border-b border-[#161820] bg-[#07080A] px-4">
				<div className="flex items-center gap-3">
					<div className="flex size-7 items-center justify-center rounded-lg bg-[#D0F237] text-black shadow-sm">
						<TbLayoutGridFilled size={16} />
					</div>
					<span className="text-sm font-bold tracking-wider text-white">FLUXIFY</span>
					
					{/* Environment Dropdown Pill */}
					<button
						type="button"
						onClick={() => navigate({ to: "/$projectId/settings", params: { projectId } })}
						className="flex items-center gap-2 rounded-full border border-[#202533] bg-[#111319] px-3 py-1 text-xs font-medium text-zinc-300 transition-colors hover:border-[#2f364a]"
					>
						<span className="size-2 rounded-full bg-[#10B981]" />
						<span>Test</span>
						<TbChevronDown size={12} className="text-zinc-400" />
					</button>

					{/* Settings/Controls Toggle */}
					<button
						type="button"
						aria-label="Project Settings"
						onClick={() => navigate({ to: "/$projectId/settings", params: { projectId } })}
						className="flex size-7 items-center justify-center rounded-full border border-[#202533] bg-[#111319] text-zinc-400 transition-colors hover:text-white"
					>
						<TbAdjustmentsHorizontal size={14} />
					</button>
				</div>

				{/* User Avatar Circle Top Right */}
				<div className="flex items-center gap-3">
					<div className="flex size-7 items-center justify-center rounded-full bg-[#202533] text-[11px] font-bold text-zinc-200">
						{initials}
					</div>
				</div>
			</header>

			{/* Main Layout Area */}
			<div className="flex min-h-0 flex-1">
				{/* Sidebar */}
				<aside className="flex w-[220px] flex-col justify-between border-r border-[#161820] bg-[#07080A] p-3">
					<nav className="flex flex-col gap-1">
						{NAV.map((item) => {
							const isActive = active === item.key;
							return (
								<button
									key={item.key}
									type="button"
									onClick={() => navigate({ to: item.to, params: { projectId } })}
									className={cn(
										"group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
										isActive
											? "bg-[#141720] text-white"
											: "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
									)}
								>
									<item.icon
										size={18}
										className={isActive ? "text-[#D0F237]" : "text-zinc-400 group-hover:text-zinc-200"}
									/>
									<span>{item.label}</span>
									{isActive && (
										<span className="ml-auto h-4 w-[3px] rounded-full bg-[#D0F237]" />
									)}
								</button>
							);
						})}
					</nav>

					{/* Sidebar Footer */}
					<div className="border-t border-[#161820] pt-3">
						<button
							type="button"
							onClick={() => navigate({ to: "/" })}
							className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-white/[0.04] hover:text-white"
						>
							<TbArrowLeft size={16} /> Back to projects
						</button>
					</div>
				</aside>

				{/* Page Content */}
				<main className="min-w-0 flex-1 overflow-y-auto bg-[#07080A] p-6">
					<Outlet />
				</main>
			</div>
		</div>
	);
}
