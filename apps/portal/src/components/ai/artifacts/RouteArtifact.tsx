import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { routesQuery } from "@/query/routesQuery";
import { RouteApplyBar } from "./ApplyBar";
import { CanvasPreview } from "./CanvasPreview";
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

function Field({
	label,
	current,
	next,
}: {
	label: string;
	current?: unknown;
	next?: unknown;
}) {
	const text = (v: unknown) =>
		v === undefined || v === null || v === ""
			? ""
			: typeof v === "string"
				? v
				: JSON.stringify(v, null, 2);
	const before = text(current);
	const after = text(next);
	// nothing proposed for this field → it stays as-is, show one box
	const changed = after !== "" && after !== before;

	return (
		<div>
			<span className="text-[10px] text-muted uppercase font-bold tracking-wider">
				{label}
			</span>
			{changed && before !== "" && (
				<pre className="text-xs whitespace-pre-wrap break-all mt-1 p-2 rounded-md bg-danger/10 border border-danger/30 text-muted line-through">
					{before}
				</pre>
			)}
			<pre
				className={`text-xs whitespace-pre-wrap break-all mt-1 p-2 rounded-md border ${
					changed
						? "bg-success/10 border-success/30 text-foreground"
						: "bg-surface-secondary border-border text-muted"
				}`}
			>
				{(changed ? after : before) || "—"}
			</pre>
		</div>
	);
}

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

	return (
		<div className="flex flex-col gap-5">
			<div className="flex items-center gap-2">
				<span className="text-xs px-2 py-0.5 rounded-md border border-border bg-surface-secondary uppercase tracking-wider text-foreground">
					{action}
				</span>
				{subArtifact.appliedAt && (
					<span className="text-xs px-2 py-0.5 rounded-md border border-success/30 bg-success/10 text-foreground">
						applied
					</span>
				)}
			</div>

			{isDelete ? (
				<Field label="Route" current={route ? `${route.method} ${route.path}` : routeId} />
			) : (
				<>
					<Field label="Name" current={route?.name} next={proposed.name} />
					<Field label="Method" current={route?.method} next={proposed.method?.toUpperCase()} />
					<Field label="Path" current={route?.path} next={proposed.path} />
					<Field label="Body Schema" current={route?.bodySchema} next={proposed.bodySchema} />
					<Field label="Query Schema" current={route?.querySchema} next={proposed.querySchema} />
					<Field label="Params Schema" current={route?.paramsSchema} next={proposed.paramsSchema} />
				</>
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
