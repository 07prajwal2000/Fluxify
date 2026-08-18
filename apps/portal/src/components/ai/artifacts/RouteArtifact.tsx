import { Tabs } from "@fluxify/components";
import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { routesQuery } from "@/query/routesQuery";
import { RouteApplyBar } from "./ApplyBar";
import { CanvasPreview } from "./CanvasPreview";
import { Field } from "./Field";
import { useArtifactParams, useCanvasArtifact, useRunSiblings } from "./useArtifact";

/** What the route sub-agent writes (see ai-gateway `RouteConfigPayload`). */
type RouteConfigPayload = {
	action?: "create" | "delete" | "update-partial";
	routeId?: string | null;
	data?: {
		name?: string | null;
		method?: string | null;
		path?: string | null;
		bodySchema?: unknown;
		paramsSchema?: unknown;
		querySchema?: unknown;
	} | null;
};

export function RouteArtifact({ subArtifactId }: { subArtifactId: string }) {
	const { projectId, conversationId } = useArtifactParams();

	const { data: subArtifact, isLoading } =
		harnessConversationsQuery.subArtifacts.useDetailQuery(
			projectId,
			conversationId,
			subArtifactId,
		);

	const payload = (subArtifact?.payload ?? {}) as RouteConfigPayload;
	const routeId = payload.routeId ?? "";
	// create has no existing route to merge against
	const { data: route } = routesQuery.byId.useQuery(routeId);

	// The same run may have built this route's logic. Showing it here is the only
	// way to tell whether the graph changed before applying the route.
	const canvasSiblings = useRunSiblings(subArtifact?.runId, "canvas");
	const canvasSibling = canvasSiblings.find((s) => s.payload?.targetId === routeId);
	const { graph: canvasGraph } = useCanvasArtifact(canvasSibling);

	if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
	if (!subArtifact) return <p className="text-sm text-muted">Not found.</p>;

	const action = payload.action ?? "create";
	const proposed = payload.data ?? {};
	const isDelete = action === "delete";

	const title =
		proposed.name || route?.name || `${route?.method ?? ""} ${route?.path ?? routeId}`.trim();
	const method = (proposed.method ?? route?.method ?? "").toUpperCase();
	const path = proposed.path ?? route?.path ?? "";

	return (
		<div className="flex flex-col gap-5">
			<div className="rounded-xl border border-border bg-surface-secondary p-3 flex flex-col gap-2">
				<div className="flex items-center gap-2">
					<span className="text-xs px-2 py-0.5 rounded-md border border-border bg-surface uppercase tracking-wider text-foreground">
						{action}
					</span>
					{subArtifact.appliedAt && (
						<span className="text-xs px-2 py-0.5 rounded-md border border-success/30 bg-success/10 text-success">
							applied
						</span>
					)}
				</div>
				<p className="text-sm font-medium text-foreground break-words">{title || "Route"}</p>
				{(method || path) && (
					<p className="text-xs font-mono text-muted break-all">
						{method} {path}
					</p>
				)}
			</div>

			{isDelete ? (
				<Field label="Route" current={route ? `${route.method} ${route.path}` : routeId} />
			) : (
				// One panel per schema — three JSON blobs stacked in a 500px rail was
				// unreadable, and only one of them is usually what changed.
				<Tabs defaultSelectedKey="general" className="flex flex-col gap-3">
					<Tabs.List aria-label="Route settings" className="w-full">
						<Tabs.Tab id="general">General</Tabs.Tab>
						<Tabs.Tab id="params">Path</Tabs.Tab>
						<Tabs.Tab id="query">Query</Tabs.Tab>
						<Tabs.Tab id="body">Body</Tabs.Tab>
					</Tabs.List>

					<Tabs.Panel id="general" className="flex flex-col gap-4">
						<Field label="Name" current={route?.name} next={proposed.name} />
						<Field label="Method" current={route?.method} next={proposed.method?.toUpperCase()} />
						<Field label="Path" current={route?.path} next={proposed.path} />
					</Tabs.Panel>
					<Tabs.Panel id="params">
						<Field label="Path parameters" current={route?.paramsSchema} next={proposed.paramsSchema} />
					</Tabs.Panel>
					<Tabs.Panel id="query">
						<Field label="Query string" current={route?.querySchema} next={proposed.querySchema} />
					</Tabs.Panel>
					<Tabs.Panel id="body">
						<Field label="Request body" current={route?.bodySchema} next={proposed.bodySchema} />
					</Tabs.Panel>
				</Tabs>
			)}

			{canvasSibling && canvasGraph.blocks.length > 0 && (
				<div className="flex flex-col gap-2">
					<span className="text-[10px] text-muted uppercase font-bold tracking-wider">
						Canvas changes
					</span>
					<CanvasPreview graph={canvasGraph} title="Proposed canvas" />
				</div>
			)}

			<RouteApplyBar
				subArtifactId={subArtifact.id}
				canvasSubArtifactId={canvasSibling?.id}
				appliedAt={subArtifact.appliedAt}
				// a deleted route has nothing left to open
				routeId={isDelete ? undefined : (payload.routeId ?? undefined)}
				action={action}
			/>
		</div>
	);
}
