import { useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { agentConversationsQuery } from "@/query/agentConversationsQuery";
import type { ToolPart } from "../agentMessages";
import { CanvasDiffView } from "./CanvasDiffView";
import { diffCanvases, diffFromOps } from "./canvasDiff";
import { isRec, rec, str } from "./data";
import { Notice } from "./Notice";

type Issue = { severity?: string; message?: string; block?: string };

function Issues({ issues }: { issues?: Issue[] }) {
	return (
		<>
			{issues?.map((i) => (
				<Notice key={`${i.block}${i.message}`} tone={i.severity === "error" ? "danger" : "warning"}>
					{i.block ? `${i.block}: ` : ""}
					{i.message}
				</Notice>
			))}
		</>
	);
}

/** A waiting edit: the server works out the canvas as it would be after the ops, without saving. */
function PendingEdit({ input }: { input: Record<string, unknown> }) {
	const { projectId = "" } = useParams({ strict: false }) as { projectId?: string };
	const ops = useMemo(() => (Array.isArray(input.ops) ? input.ops : []), [input.ops]);
	const ready = Boolean(projectId) && isRec(input.target);
	const preview = agentConversationsQuery.preview.canvas.useQuery(
		projectId,
		{
			target: rec(input.target) as { kind: string; id: string },
			ops,
			...(input.auto_layout === true && { auto_layout: true }),
		},
		ready,
	);
	const data = preview.data;
	// one diff per answer: a new object would rebuild the whole canvas
	const diff = useMemo(
		() => (data?.after ? diffCanvases(data.before, data.after) : diffFromOps(ops)),
		[data, ops],
	);
	if (preview.isLoading)
		return <div className="h-64 animate-pulse rounded-lg bg-surface-secondary" aria-busy />;
	if (!data?.after) {
		// refused ops or an unreachable server: still show what the ops say
		const reason = data?.error ?? (preview.error as Error | null)?.message;
		return (
			<div className="flex flex-col gap-2">
				<Notice tone="danger">
					{data
						? `This edit would be refused: ${reason}`
						: `Could not preview this edit: ${reason}`}
				</Notice>
				<CanvasDiffView diff={diff} />
			</div>
		);
	}
	return (
		<div className="flex flex-col gap-2">
			{data.error && <Notice tone="danger">This edit would be refused: {data.error}</Notice>}
			<Issues issues={data.issues} />
			<CanvasDiffView diff={diff} />
		</div>
	);
}

/** An edit that ran: the canvas it changed is not kept, so the diff is the blocks the ops touched. */
function AppliedEdit({ tool }: { tool: ToolPart }) {
	const out = rec(tool.output);
	const diff = useMemo(() => {
		const input = rec(tool.input);
		const refs = Object.fromEntries(
			Object.entries(rec(rec(tool.output).refs)).map(([k, v]) => [k, str(v)]),
		);
		return diffFromOps(Array.isArray(input.ops) ? input.ops : [], refs);
	}, [tool.input, tool.output]);
	return (
		<div className="flex flex-col gap-2">
			<CanvasDiffView diff={diff} />
			<Issues issues={Array.isArray(out.issues) ? (out.issues as Issue[]) : undefined} />
		</div>
	);
}

/** `asking`: it waits for an answer. A call that runs without asking has no "after" to compute: the canvas may already have changed. */
export function EditCanvasPreview({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	return asking ? <PendingEdit input={rec(tool.input)} /> : <AppliedEdit tool={tool} />;
}
