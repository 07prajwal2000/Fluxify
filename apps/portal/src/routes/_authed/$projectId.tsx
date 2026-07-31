import {
	createFileRoute,
	Outlet,
	redirect,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import {
	TbActivity,
	TbBox,
	TbCloudCog,
	TbLayoutGridFilled,
	TbSparkles,
	TbSquareKey,
	TbStack2,
	TbUser,
	TbLogout,
} from "react-icons/tb";
import { cn, Dropdown } from "@fluxify/components";
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

	async function logout() {
		await authClient.signOut();
		navigate({ to: "/login" });
	}

	return (
		<div className="flex h-screen w-screen bg-[#07080A] text-foreground font-sans antialiased">
			{/* Sidebar spacer */}
			<div className="w-[60px] shrink-0 border-r border-[#161820]" />

			{/* Actual Sidebar */}
			<aside className="group absolute left-0 top-0 z-50 flex h-full w-[60px] flex-col justify-between overflow-hidden border-r border-[#161820] bg-[#07080A] transition-[width] duration-300 hover:w-[220px]">
				<div className="flex flex-col">
					{/* Logo */}
					<div className="flex h-[56px] shrink-0 items-center px-4">
						<div className="flex size-7 shrink-0 items-center justify-center rounded-lg text-black shadow-sm">
							<img src="/_/admin/ui/public/icons/logo.svg" alt="logo" />
						</div>
						<span className="ml-3 whitespace-nowrap text-sm font-bold tracking-wider text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100">
							FLUXIFY
						</span>
					</div>

					{/* Separator */}
					<div className="mx-3 mb-3 h-px bg-[#161820]" />

					{/* Navigation */}
					<nav className="flex flex-col gap-1 px-2">
						{NAV.map((item) => {
							const isActive = active === item.key;
							return (
								<button
									key={item.key}
									type="button"
									onClick={() => navigate({ to: item.to, params: { projectId } })}
									className={cn(
										"group/btn relative flex h-10 items-center rounded-lg px-2.5 text-sm font-medium transition-colors",
										isActive
											? "bg-[#141720] text-white"
											: "text-zinc-400 hover:bg-white/[0.04] hover:text-zinc-200",
									)}
								>
									<item.icon
										size={18}
										className={cn(
											"shrink-0",
											isActive ? "text-[#D0F237]" : "text-zinc-400 group-hover/btn:text-zinc-200"
										)}
									/>
									<span className="ml-3 whitespace-nowrap opacity-0 transition-opacity duration-300 group-hover:opacity-100">
										{item.label}
									</span>
									{isActive && (
										<span className="absolute -left-2 h-4 w-[3px] rounded-r-full bg-[#D0F237]" />
									)}
								</button>
							);
						})}
					</nav>
				</div>

				{/* Sidebar Footer (User Account Menu) */}
				<div className="border-t border-[#161820] p-2">
					<Dropdown>
						<Dropdown.Trigger
							aria-label="Account menu"
							className="flex w-full items-center overflow-hidden rounded-lg p-1 outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
						>
							<div className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-[#202533] text-xs font-bold text-zinc-200">
								{initials}
							</div>
							<div className="ml-3 flex flex-col items-start whitespace-nowrap opacity-0 transition-opacity duration-300 group-hover:opacity-100">
								<span className="text-sm font-medium text-white">{userData?.name || "User"}</span>
								<span className="text-[11px] text-zinc-500">{userData?.email || ""}</span>
							</div>
						</Dropdown.Trigger>
						<Dropdown.Popover>
							<Dropdown.Menu>
								<Dropdown.Item onAction={() => navigate({ to: "/", search: { tab: "account" } })}>
									<TbUser size={18} /> Profile
								</Dropdown.Item>
								<Dropdown.Item onAction={logout}>
									<TbLogout size={18} /> Logout
								</Dropdown.Item>
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
				</div>
			</aside>

			{/* Page Content */}
			<main className="min-w-0 flex-1 overflow-y-auto bg-[#07080A] p-6">
				<Outlet />
			</main>
		</div>
	);
}
