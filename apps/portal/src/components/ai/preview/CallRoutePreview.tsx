import type { ToolPart } from "../agentMessages";
import { JsonBlock } from "./Collapsible";
import { type Data, isRec, rec, str } from "./data";
import { Notice } from "./Notice";
import { TraceList } from "./TraceList";
import { useCurrent } from "./useCurrent";

/** `/users/:id` with the params filled in, and the query string. */
function requestPath(path: string, params: Data, query: Data) {
	const filled = path.replace(/:([A-Za-z0-9_]+)/g, (m, name) => str(params[name]) || m);
	const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, str(v)])).toString();
	return qs ? `${filled}?${qs}` : filled;
}

const statusTone = (s: number) =>
	s >= 400
		? "border-danger/50 bg-danger/10 text-danger"
		: s >= 300
			? "border-border bg-surface text-muted"
			: "border-success/50 bg-success/10 text-success";

/** call_route's `error`: the block that failed, why, and the real cause its callers never see. */
function CallError({ error }: { error: unknown }) {
	const e = rec(error);
	const block = rec(e.block);
	const who = str(block.key) || str(block.id);
	return (
		<Notice tone="danger">
			{who && (
				<strong className="font-mono">
					{who}
					{block.type ? ` (${str(block.type)})` : ""}
					{": "}
				</strong>
			)}
			{isRec(error) ? str(e.message) : str(error)}
			{e.detail ? `\n${str(e.detail)}` : ""}
		</Notice>
	);
}

/** call_route: the request line, the answer, and the blocks that ran. Works before the call too (an approval): the request alone. */
export function CallRoutePreview({ tool }: { tool: ToolPart }) {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const { current: route } = useCurrent("call_route", input, true);
	const status = typeof out.status === "number" ? out.status : undefined;
	const request = [
		str(route?.method) || "Route",
		route?.path
			? requestPath(str(route.path), rec(input.params), rec(input.query))
			: str(input.routeId),
	].join(" ");
	const trace = Array.isArray(out.trace) ? (out.trace as string[]) : [];
	return (
		<div className="flex flex-col gap-2">
			{out.error !== undefined && <CallError error={out.error} />}
			<div className="flex flex-wrap items-center gap-2 text-sm">
				{status !== undefined && (
					<span className={`rounded-full border px-2 text-xs font-medium ${statusTone(status)}`}>
						{status}
					</span>
				)}
				<code className="font-mono text-foreground">{request}</code>
				{typeof out.durationMs === "number" && (
					<span className="text-xs text-muted">{out.durationMs}ms</span>
				)}
			</div>
			{(["params", "query", "headers", "body"] as const)
				.filter(
					(k) =>
						input[k] !== undefined && !(isRec(input[k]) && !Object.keys(input[k] as Data).length),
				)
				.map((k) => (
					<JsonBlock key={k} label={`Request ${k}`} value={input[k]} />
				))}
			{out.body !== undefined && <JsonBlock label="Response body" value={out.body} />}
			{isRec(out.headers) && Object.keys(out.headers).length > 0 && (
				<JsonBlock label="Response headers" value={out.headers} />
			)}
			{trace.length > 0 && (
				<section className="flex flex-col gap-1" aria-label="Trace">
					<h4 className="text-xs font-medium text-muted">Blocks that ran</h4>
					<TraceList lines={trace} />
				</section>
			)}
		</div>
	);
}
