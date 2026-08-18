import { harnessConversationsQuery } from "@/query/harnessConversationsQuery";
import { ApplyBar } from "./ApplyBar";
import { CanvasPreview } from "./CanvasPreview";
import { useArtifactParams, useCustomBlockCanvasArtifact, useRunSiblings } from "./useArtifact";

export function CustomBlockArtifact({ subArtifactId }: { subArtifactId: string }) {
	const { projectId, conversationId } = useArtifactParams();
	const { data: detail, isLoading } = harnessConversationsQuery.subArtifacts.useDetailQuery(projectId, conversationId, subArtifactId);
	const payload = (detail?.payload ?? {}) as {
		action?: "create" | "delete" | "update-partial";
		customBlockId?: string;
		data?: { name?: string; label?: string; description?: string; inputParams?: Array<{ name?: string; type?: string; label?: string }> };
	};
	const action = payload.action ?? "create";
	const customBlockId = payload.customBlockId ?? "";
	const data = payload.data ?? {};
	const canvasSibling = useRunSiblings(detail?.runId, "canvas").find(
		(s) => s.payload?.targetType === "custom_block" && s.payload?.targetId === customBlockId,
	);
	const { graph: canvasGraph } = useCustomBlockCanvasArtifact(canvasSibling);
	if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
	if (!detail) return <p className="text-sm text-muted">Not found.</p>;
	return <div className="flex flex-col gap-4">
		<div className="flex items-center gap-2">
			<span className="text-xs px-2 py-0.5 rounded-md border border-border bg-surface-secondary uppercase tracking-wider text-foreground">{action}</span>
			{detail.appliedAt && <span className="text-xs px-2 py-0.5 rounded-md border border-success/30 bg-success/10 text-foreground">applied</span>}
		</div>
		<div className="rounded-xl border border-border bg-surface-secondary p-3">
			<p className="text-sm font-medium text-foreground">{data.label ?? data.name ?? "Custom block"}</p>
			{data.name && <p className="text-xs font-mono text-muted mt-1">{data.name}</p>}
			{data.description && <p className="text-xs text-muted mt-2">{data.description}</p>}
		</div>
		<div className="flex flex-col gap-2">
			<span className="text-[10px] text-muted uppercase font-bold tracking-wider">Caller parameters</span>
			{data.inputParams?.length ? data.inputParams.map((param, index) => <div key={`${param.name ?? "param"}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-secondary px-3 py-2"><span className="text-sm font-mono text-foreground">{param.name ?? "unnamed"}</span><span className="text-xs text-muted">{param.type ?? "unknown"}{param.label ? ` · ${param.label}` : ""}</span></div>) : <p className="text-sm text-muted">No caller parameters</p>}
		</div>
		{canvasSibling && canvasGraph.blocks.length > 0 && <div className="flex flex-col gap-2"><span className="text-[10px] text-muted uppercase font-bold tracking-wider">Canvas changes</span><CanvasPreview graph={canvasGraph} title="Proposed custom-block canvas" /></div>}
		<ApplyBar subArtifactId={detail.id} appliedAt={detail.appliedAt} customBlockId={action === "delete" ? undefined : (payload.customBlockId ?? undefined)} label={`${action === "delete" ? "Delete" : action === "update-partial" ? "Update" : "Create"} custom block${canvasSibling ? " with canvas" : ""}`} />
	</div>;
}
