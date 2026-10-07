import { CustomSelect, type CustomSelectOption, Dropdown } from "@fluxify/components";
import { TbDotsVertical, TbPlayerPlay, TbTopologyStar3 } from "react-icons/tb";
import type { RouteRow } from "@/routes/_authed/$projectId/routes";
import type { Workflow } from "@/services/workflows";

interface ExecutionTargetHeaderProps {
	projectId: string;
	targetType: "route" | "workflow";
	targetId: string;
	routes: RouteRow[];
	workflows: Workflow[];
	onSelectTarget: (type: "route" | "workflow", id: string) => void;
	onOpenCanvas: () => void;
	onOpenPlayground: () => void;
	onOpenRunWorkflow: () => void;
}

export function ExecutionTargetHeader({
	targetType,
	targetId,
	routes,
	workflows,
	onSelectTarget,
	onOpenCanvas,
	onOpenPlayground,
	onOpenRunWorkflow,
}: ExecutionTargetHeaderProps) {
	const routeOptions: CustomSelectOption[] = routes.map((r) => {
		const label = `${r.method ? r.method.toUpperCase() : "GET"} ${r.path || "Untitled"}${r.name ? ` (${r.name})` : ""}`;
		return {
			value: r.id,
			label,
			node: (
				<span className="flex items-center gap-2 truncate">
					{r.recordExecution && (
						<span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
					)}
					<span className="truncate">{label}</span>
				</span>
			),
		};
	});

	const workflowOptions: CustomSelectOption[] = workflows.map((w) => {
		const label = w.name || "Untitled workflow";
		return {
			value: w.id,
			label,
			node: (
				<span className="flex items-center gap-2 truncate">
					{w.recordExecution && (
						<span className="size-2 shrink-0 animate-pulse rounded-full bg-danger" aria-hidden />
					)}
					<span className="truncate">{label}</span>
				</span>
			),
		};
	});

	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 className="text-xl font-semibold tracking-tight">Executions</h1>
				<p className="text-sm text-muted">
					Inspect recorded execution traces, debug individual spans, and replay runtime values.
				</p>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{/* Type Switcher */}
				<div className="flex items-center gap-0.5 rounded-lg border border-border bg-background-secondary p-0.5">
					<button
						type="button"
						onClick={() => {
							const first = routes[0]?.id;
							if (first) onSelectTarget("route", first);
						}}
						className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
							targetType === "route"
								? "bg-accent/10 font-semibold text-accent"
								: "text-muted hover:text-foreground"
						}`}
					>
						Routes ({routes.length})
					</button>
					<button
						type="button"
						onClick={() => {
							const first = workflows[0]?.id;
							if (first) onSelectTarget("workflow", first);
						}}
						className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
							targetType === "workflow"
								? "bg-accent/10 font-semibold text-accent"
								: "text-muted hover:text-foreground"
						}`}
					>
						Workflows ({workflows.length})
					</button>
				</div>

				{/* Target Dropdown */}
				<div className="w-64">
					<CustomSelect
						aria-label={`Select ${targetType}`}
						options={targetType === "route" ? routeOptions : workflowOptions}
						value={targetId}
						onChange={(id) => onSelectTarget(targetType, id)}
						placeholder={`Select ${targetType}`}
					/>
				</div>

				{/* 3-dots actions menu */}
				<Dropdown>
					<Dropdown.Trigger
						aria-label="Target actions"
						className="inline-flex size-8 items-center justify-center rounded-lg border border-border bg-surface text-foreground transition-colors hover:bg-surface-secondary"
					>
						<TbDotsVertical size={16} />
					</Dropdown.Trigger>
					<Dropdown.Popover placement="bottom end">
						<Dropdown.Menu aria-label="Target actions">
							<Dropdown.Item onAction={onOpenCanvas} textValue="Open Canvas">
								<div className="flex items-center gap-2">
									<TbTopologyStar3 size={15} />
									<span>Open Canvas</span>
								</div>
							</Dropdown.Item>
							{targetType === "route" ? (
								<Dropdown.Item onAction={onOpenPlayground} textValue="API Playground">
									<div className="flex items-center gap-2">
										<TbPlayerPlay size={15} />
										<span>API Playground</span>
									</div>
								</Dropdown.Item>
							) : (
								<Dropdown.Item onAction={onOpenRunWorkflow} textValue="Run Workflow">
									<div className="flex items-center gap-2">
										<TbPlayerPlay size={15} />
										<span>Run Workflow</span>
									</div>
								</Dropdown.Item>
							)}
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
		</div>
	);
}
