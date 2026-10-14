import { formatDuration } from "@/components/testSuites/CaseResults";
import type { ToolPart } from "../agentMessages";
import { BlocksCanvas } from "./BlocksCanvas";
import { JsonBlock } from "./Collapsible";
import { type Data, isRec, rec, str } from "./data";
import { EnvChip } from "./EnvChip";
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

/** The environment a call ran in. `call_route` and the others run development; the result says so when it can. */
const envOf = (tool: ToolPart) =>
	str(rec(tool.output).env) || str(rec(tool.input).env) || "development";

/**
 * The request line a call made: `call_route` looks its route up for the method
 * and the filled path; a sandbox or an ephemeral run is given them outright.
 */
function useRequestLine(tool: ToolPart) {
	const input = rec(tool.input);
	const isRoute = tool.name === "call_route";
	const { current: route } = useCurrent("call_route", input, isRoute);
	if (!isRoute) return `${str(input.method) || "GET"} ${str(input.path) || "/"}`;
	return [
		str(route?.method) || "Route",
		route?.path
			? requestPath(str(route.path), rec(input.params), rec(input.query))
			: str(input.routeId),
	].join(" ");
}

/** The folded row of a call_route (#780): status, the Dev / Prod chip, the request line, and how long it took. */
export function CallRouteHeader({ tool }: { tool: ToolPart }) {
	const out = rec(tool.output);
	const status = typeof out.status === "number" ? out.status : undefined;
	const request = useRequestLine(tool);
	return (
		<span className="inline-flex min-w-0 max-w-full items-center gap-1.5 align-middle">
			{status !== undefined && (
				<span
					className={`shrink-0 rounded-full border px-1.5 text-[11px] font-medium ${statusTone(status)}`}
				>
					{status}
				</span>
			)}
			<EnvChip env={envOf(tool)} />
			<span className="min-w-0 truncate">{request}</span>
			{typeof out.durationMs === "number" && (
				<span className="shrink-0">({formatDuration(out.durationMs)})</span>
			)}
		</span>
	);
}

const LABEL: Record<string, string> = { input: "Request body" };

/**
 * call_route, call_sandbox and run_blocks: the request line, the answer, and the blocks that ran.
 * Works before the call too (an approval): the request alone. A sandbox or an ephemeral run
 * has no route to look up, so its request line is the method and path it was given.
 */
export function CallRoutePreview({ tool }: { tool: ToolPart }) {
	const input = rec(tool.input);
	const out = rec(tool.output);
	const request = useRequestLine(tool);
	const status = typeof out.status === "number" ? out.status : undefined;
	const kind =
		tool.name === "run_blocks" ? "Ephemeral run" : tool.name === "call_sandbox" ? "Sandbox" : "";
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
				{kind && <span className="text-xs text-muted">{kind}</span>}
				<code className="font-mono text-foreground">{request}</code>
				{typeof out.durationMs === "number" && (
					<span className="text-xs text-muted">{formatDuration(out.durationMs)}</span>
				)}
			</div>
			{tool.name === "run_blocks" && <BlocksCanvas input={tool.input} />}
			{(["params", "query", "headers", "body", "input"] as const)
				.filter(
					(k) =>
						input[k] !== undefined && !(isRec(input[k]) && !Object.keys(input[k] as Data).length),
				)
				.map((k) => (
					<JsonBlock key={k} label={LABEL[k] ?? `Request ${k}`} value={input[k]} />
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
