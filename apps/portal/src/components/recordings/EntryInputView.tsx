import { Chip } from "@fluxify/components";
import type { RecordedSpan } from "@/services/recordings";
import { PayloadViewer } from "./PayloadViewer";

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
	!!value && typeof value === "object" && !Array.isArray(value);

/**
 * What a run's own entrypoint recorded as its input (#628): the whole request
 * on a route, the job input and trigger on a workflow. Null for any other span,
 * a custom block's entrypoint included, and for runs recorded before #628.
 */
export function entryInput(span: RecordedSpan) {
	if (span.blockType !== "entrypoint" || span.parentSeq != null || span.customBlockId) return null;
	const input = span.input;
	if (!isFields(input)) return null;
	if (typeof input.method === "string" && "headers" in input) {
		return { kind: "request" as const, input };
	}
	if (isFields(input.trigger)) return { kind: "trigger" as const, input };
	return null;
}

const show = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/** a name / value table; nothing when there are no entries */
function KeyValues({ title, value }: { title: string; value: unknown }) {
	if (!isFields(value)) {
		// a value cut to fit the cap is a string, not an object any more
		return value == null ? null : <PayloadViewer title={title} value={value} truncated />;
	}
	const entries = Object.entries(value);
	if (entries.length === 0) return null;
	return (
		<div className="rounded-md border border-border bg-background">
			<p className="px-3 py-1.5 text-xs font-medium text-foreground">{title}</p>
			<table className="w-full table-fixed border-t border-border text-xs">
				<tbody>
					{entries.map(([name, item]) => (
						<tr key={name} className="border-b border-border last:border-b-0">
							<td className="w-1/3 truncate px-3 py-1 font-mono text-muted" title={name}>
								{name}
							</td>
							<td className="break-all px-3 py-1 font-mono text-foreground">{show(item)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function RequestView({ input, truncated }: { input: Fields; truncated: boolean }) {
	return (
		<div className="space-y-2">
			<p className="text-xs font-semibold text-foreground">Request</p>
			<div className="flex items-center gap-2 text-xs">
				<Chip size="sm">{show(input.method)}</Chip>
				<span className="break-all font-mono text-foreground">{show(input.url ?? input.path)}</span>
			</div>
			<KeyValues title="Headers" value={input.headers} />
			<KeyValues title="Query" value={input.query} />
			<KeyValues title="Params" value={input.params} />
			<KeyValues title="Cookies" value={input.cookies} />
			<PayloadViewer title="Body" value={input.body} truncated={truncated} />
		</div>
	);
}

function TriggerView({ input, truncated }: { input: Fields; truncated: boolean }) {
	const { origin, batch, events, ...trigger } = input.trigger as Fields;
	return (
		<div className="space-y-2">
			<p className="text-xs font-semibold text-foreground">Trigger</p>
			<KeyValues title="Trigger" value={trigger} />
			<KeyValues title="Origin" value={origin} />
			<KeyValues title="Batch" value={batch} />
			<PayloadViewer title="Events" value={events} truncated={truncated} />
			<PayloadViewer title="Input" value={input.input} truncated={truncated} />
		</div>
	);
}

/** the entrypoint's Request or Trigger view, in place of its raw input */
export function EntryInputView({ span }: { span: RecordedSpan }) {
	const entry = entryInput(span);
	if (!entry) return null;
	return entry.kind === "request" ? (
		<RequestView input={entry.input} truncated={span.truncated} />
	) : (
		<TriggerView input={entry.input} truncated={span.truncated} />
	);
}
