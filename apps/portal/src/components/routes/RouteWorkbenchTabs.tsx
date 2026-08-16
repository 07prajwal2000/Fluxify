import { Link } from "@tanstack/react-router";
import { cn } from "@fluxify/components";
import { TbFlask, TbTopologyStar3 } from "react-icons/tb";

const TABS = [
	{ label: "Canvas", icon: TbTopologyStar3, to: "/$projectId/canvas/$routeId" },
	{ label: "Tests", icon: TbFlask, to: "/$projectId/canvas/$routeId/test-suites" },
] as const;

/**
 * Segmented switcher between a route's workbench views. Links rather than tab
 * panels: each view is its own route, so the browser keeps the history entry.
 */
export function RouteWorkbenchTabs({
	projectId,
	routeId,
}: {
	projectId: string;
	routeId: string;
}) {
	return (
		<div className="flex items-center gap-0.5 rounded-lg border border-border bg-background-secondary p-0.5">
			{TABS.map(({ label, icon: Icon, to }) => (
				<Link
					key={to}
					to={to}
					params={{ projectId, routeId }}
					activeOptions={{ exact: true }}
					className="rounded-md px-2.5 py-1 text-xs font-medium text-muted transition-colors hover:text-foreground"
					activeProps={{ className: "bg-accent/10 text-accent" }}
				>
					<span className="flex items-center gap-1.5">
						<Icon size={15} />
						{label}
					</span>
				</Link>
			))}
		</div>
	);
}

/** The shared topbar shell — the canvas grows its own, this is for the sibling views. */
export function RouteWorkbenchHeader({
	children,
	className,
}: {
	children: React.ReactNode;
	className?: string;
}) {
	return (
		<header
			className={cn(
				"flex items-center gap-3 border-b border-border px-4 py-2 text-sm",
				className,
			)}
		>
			{children}
		</header>
	);
}
