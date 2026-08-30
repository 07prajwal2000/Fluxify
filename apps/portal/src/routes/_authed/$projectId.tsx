import {
	createFileRoute,
	Outlet,
	redirect,
	useLocation,
	useNavigate,
} from "@tanstack/react-router";
import { useState } from "react";
import {
	TbActivity,
	TbBolt,
	TbBox,
	TbChevronDown,
	TbCloudCog,
	TbLayoutGridFilled,
	TbRoute,
	TbSparkles,
	TbSquareKey,
	TbStack2,
	TbUser,
	TbLogout,
	TbArrowLeft,
	TbSettings,
} from "react-icons/tb";
import { cn, Dropdown, Tooltip } from "@fluxify/components";
import { authClient } from "@/lib/auth";
import { useAuthStore } from "@/store/auth";
import { createRouteHead } from "@/lib/seo";

// BASE_URL, not a hardcoded path: files in public/ are served from the bundle
// root, so the literal "/_/admin/ui/public/..." resolved to nothing and the SPA
// fallback answered with index.html — an HTML body where an image was expected.
const logo = `${import.meta.env.BASE_URL}icons/logo.webp`;

/**
 * The sidebar, as a tree. Anything with `children` renders as a collapsible
 * group; everything else is a plain link. Routes, workflows and triggers are
 * the three ways work gets started in a project, and executions is the record
 * of what that work did — so they live together under one heading rather than
 * as four siblings of "Integrations".
 */
const NAV = [
	{ key: "ai", label: "Fluxify AI", to: "/$projectId/ai", icon: TbSparkles },
	{
		key: "endpoints",
		label: "Endpoints & Automation",
		icon: TbBolt,
		children: [
			{ key: "routes", label: "Routes", to: "/$projectId/routes", icon: TbStack2 },
			{ key: "workflows", label: "Workflows", to: "/$projectId/workflows", icon: TbRoute },
			{ key: "triggers", label: "Triggers", to: "/$projectId/triggers", icon: TbBolt },
			{ key: "executions", label: "Executions", to: "/$projectId/executions", icon: TbActivity },
		],
	},
	{ key: "integrations", label: "Integrations", to: "/$projectId/integrations", icon: TbCloudCog },
	{ key: "app-config", label: "App config", to: "/$projectId/app-config", icon: TbSquareKey },
	{ key: "custom-blocks", label: "Custom Blocks", to: "/$projectId/custom-blocks", icon: TbBox },
] as const;

/** Every page key, group children included — what the URL is matched against. */
const NAV_KEYS: string[] = NAV.flatMap((item) =>
	"children" in item ? item.children.map((child) => child.key) : [item.key],
);

export const Route = createFileRoute("/_authed/$projectId")({
	head: createRouteHead("Project Workspace", "Manage project API routes, workflows, and configurations."),
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

/** One row of the sidebar — a link, or the header of a collapsible group. */
function NavButton({
	icon: Icon,
	label,
	isActive,
	onClick,
	trailing,
}: {
	icon: React.ComponentType<{ size?: number; className?: string }>;
	label: string;
	isActive: boolean;
	onClick: () => void;
	trailing?: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			className={cn(
				"group/btn relative flex h-10 items-center rounded-lg px-2.5 text-sm font-medium transition-colors",
				isActive
					? "bg-surface-secondary text-foreground"
					: "text-muted hover:bg-surface-secondary hover:text-foreground",
			)}
		>
			<Icon
				size={18}
				className={cn(
					"shrink-0",
					isActive ? "text-accent" : "text-muted group-hover/btn:text-foreground",
				)}
			/>
			<span className="ml-3 flex min-w-0 flex-1 items-center whitespace-nowrap opacity-0 transition-opacity duration-300 group-hover:opacity-100">
				<span className="truncate">{label}</span>
				{trailing}
			</span>
			{isActive && (
				<span className="absolute -left-2 h-4 w-[3px] rounded-r-full bg-accent" />
			)}
		</button>
	);
}

function ProjectLayout() {
	const { projectId } = Route.useParams();
	const navigate = useNavigate();
	const location = useLocation();
	const { userData } = useAuthStore();
	const active = location.pathname.includes("/settings")
		? "settings"
		: (NAV_KEYS.find((key) => location.pathname.includes(`/${key}`)) ?? "routes");
	// A group opens itself when one of its pages is on screen, and stays open
	// after that unless the user closes it.
	const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

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
		<div className="flex h-screen w-screen bg-background text-foreground font-sans antialiased">
			{/* Sidebar spacer */}
			<div className="w-[60px] shrink-0 border-r border-border" />

			{/* Actual Sidebar */}
			<aside className="group absolute left-0 top-0 z-50 flex h-full w-[60px] flex-col justify-between overflow-hidden border-r border-border bg-background-secondary transition-[width] duration-300 hover:w-[220px]">
				<div className="flex flex-col">
					{/* Logo */}
					<div className="flex h-[56px] shrink-0 items-center px-4">
						<div className="flex size-7 shrink-0 items-center justify-center rounded-lg shadow-sm">
							<img src={logo} alt="logo" />
						</div>
						<span className="ml-3 flex-1 whitespace-nowrap text-sm font-bold tracking-wider text-foreground opacity-0 transition-opacity duration-300 group-hover:opacity-100">
							FLUXIFY
						</span>
						<Tooltip>
							<button
								type="button"
								onClick={() => navigate({ to: "/" })}
								className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted opacity-0 transition-all duration-300 hover:bg-surface-secondary hover:text-foreground group-hover:opacity-100"
							>
								<TbArrowLeft size={18} />
							</button>
							<Tooltip.Content>Back to projects</Tooltip.Content>
						</Tooltip>
					</div>

					{/* Separator */}
					<div className="mx-3 mb-3 h-px bg-border" />

					{/* Navigation */}
					<nav className="flex flex-col gap-1 px-2">
						{NAV.map((item) => {
							if (!("children" in item))
								return (
									<NavButton
										key={item.key}
										icon={item.icon}
										label={item.label}
										isActive={active === item.key}
										onClick={() => navigate({ to: item.to, params: { projectId } })}
									/>
								);

							const holdsActive = item.children.some((child) => child.key === active);
							const isOpen = openGroups[item.key] ?? holdsActive;
							return (
								<div key={item.key} className="flex flex-col gap-1">
									<NavButton
										icon={item.icon}
										label={item.label}
										// stays lit while one of its pages is open — the rail is icons
										// only until it is hovered, so the child row cannot say it
										isActive={holdsActive}
										onClick={() =>
											setOpenGroups((groups) => ({ ...groups, [item.key]: !isOpen }))
										}
										trailing={
											<TbChevronDown
												size={14}
												className={cn(
													"ml-auto shrink-0 transition-transform duration-200",
													isOpen && "rotate-180",
												)}
											/>
										}
									/>
									{/* the labels are hidden while the rail is collapsed, so the
									    children only make sense once it has expanded */}
									{isOpen && (
										<div className="hidden flex-col gap-1 border-l border-border pl-2 group-hover:flex">
											{item.children.map((child) => (
												<NavButton
													key={child.key}
													icon={child.icon}
													label={child.label}
													isActive={active === child.key}
													onClick={() => navigate({ to: child.to, params: { projectId } })}
												/>
											))}
										</div>
									)}
								</div>
							);
						})}
					</nav>
				</div>

				{/* Sidebar Footer (User Account Menu) */}
				<div className="flex flex-col gap-1 border-t border-border p-2">
					<button
						type="button"
						onClick={() => navigate({ to: "/$projectId/settings", params: { projectId } })}
						className={cn(
							"group/btn relative flex h-10 items-center rounded-lg px-2.5 text-sm font-medium transition-colors",
							active === "settings"
								? "bg-surface-secondary text-foreground"
								: "text-muted hover:bg-surface-secondary hover:text-foreground",
						)}
					>
						<TbSettings
							size={18}
							className={cn(
								"shrink-0",
								active === "settings" ? "text-accent" : "text-muted group-hover/btn:text-foreground"
							)}
						/>
						<span className="ml-3 whitespace-nowrap opacity-0 transition-opacity duration-300 group-hover:opacity-100">
							Project Settings
						</span>
						{active === "settings" && (
							<span className="absolute -left-2 h-4 w-[3px] rounded-r-full bg-accent" />
						)}
					</button>
					<Dropdown>
						<Dropdown.Trigger
							aria-label="Account menu"
							className="flex w-full items-center overflow-hidden rounded-lg p-1 outline-none transition-colors hover:bg-surface-secondary focus-visible:ring-2 focus-visible:ring-focus"
						>
							<div className="flex size-[34px] shrink-0 items-center justify-center rounded-full bg-surface-secondary text-xs font-bold text-foreground ring-1 ring-border">
								{initials}
							</div>
							<div className="ml-3 flex flex-col items-start whitespace-nowrap opacity-0 transition-opacity duration-300 group-hover:opacity-100">
								<span className="text-sm font-medium text-foreground">{userData?.name || "User"}</span>
								<span className="text-[11px] text-muted">{userData?.email || ""}</span>
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
			<main className="min-w-0 flex-1 overflow-y-auto bg-background p-6">
				<Outlet />
			</main>
		</div>
	);
}
