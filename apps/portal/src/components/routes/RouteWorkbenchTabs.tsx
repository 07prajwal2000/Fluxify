import { cn } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import type { IconType } from "react-icons";
import { TbFlask, TbTopologyStar3 } from "react-icons/tb";

type Tab = { label: string; icon: IconType; to: string };

const ROUTE_TABS: Tab[] = [
	{ label: "Canvas", icon: TbTopologyStar3, to: "/$projectId/canvas/$routeId" },
	{ label: "Tests", icon: TbFlask, to: "/$projectId/canvas/$routeId/test-suites" },
];

const WORKFLOW_TABS: Tab[] = [
	{ label: "Canvas", icon: TbTopologyStar3, to: "/$projectId/workflow-canvas/$workflowId" },
	{ label: "Tests", icon: TbFlask, to: "/$projectId/workflow-canvas/$workflowId/test-suites" },
];

/**
 * Segmented switcher between a workbench's views. Links rather than tab
 * panels: each view is its own route, so the browser keeps the history entry.
 */
function WorkbenchTabs({ tabs, params }: { tabs: Tab[]; params: Record<string, string> }) {
	return (
		<div className="flex items-center gap-0.5 rounded-lg border border-border bg-background-secondary p-0.5">
			{tabs.map(({ label, icon: Icon, to }) => (
				<Link
					key={to}
					// the tab lists pair each path with its own params
					to={to as never}
					params={params as never}
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

export function RouteWorkbenchTabs({ projectId, routeId }: { projectId: string; routeId: string }) {
	return <WorkbenchTabs tabs={ROUTE_TABS} params={{ projectId, routeId }} />;
}

/** a workflow's canvas and its test suites (#487) */
export function WorkflowWorkbenchTabs({
	projectId,
	workflowId,
}: {
	projectId: string;
	workflowId: string;
}) {
	return <WorkbenchTabs tabs={WORKFLOW_TABS} params={{ projectId, workflowId }} />;
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
			className={cn("flex items-center gap-3 border-b border-border px-4 py-2 text-sm", className)}
		>
			{children}
		</header>
	);
}
