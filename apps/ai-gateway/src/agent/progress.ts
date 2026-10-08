import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import type { runAgent } from "./agent";
import { stopMessage } from "./guards";

export type Log = (event: string, data?: Record<string, unknown>) => void;
/** `paused` holds the status line while the user answers a prompt. */
export type Out = { write: (s: string) => void; tty?: boolean; log?: Log; paused?: () => boolean };

const MAX_CHARS = 200;
export const short = (v: unknown) => {
	const s = typeof v === "string" ? v : JSON.stringify(v);
	return s && s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…` : s;
};
/** A canvas op in a few words: "add_block response a after entry". */
const op = (o: any) => {
	if (o.op === "add_block")
		return `add_block ${o.type} ${o.ref}${o.connect_from ? ` after ${o.connect_from.from}` : ""}${o.data ? ` ${short(o.data)}` : ""}`;
	if (o.op === "update_block") return `update_block ${o.id} ${short(o.data)}`;
	if (o.op === "remove_block") return `remove_block ${o.id}`;
	return `${o.op} ${o.from} → ${o.to}${o.handle ? ` (${o.handle})` : ""}`;
};

/** What an approval prompt shows: the tool and its arguments, edit_canvas one op per line. */
export function describeCall(name: string, input: any) {
	if (name !== "edit_canvas" || !Array.isArray(input?.ops)) return `${name} ${short(input)}`;
	const flags = ["validate", "auto_layout"].filter((f) => input[f]).join(", ");
	const head = `edit_canvas ${input.target?.kind} ${input.target?.id} (v${input.version})${flags ? `, ${flags}` : ""}`;
	return [head, ...input.ops.map((o: unknown) => `  • ${op(o)}`)].join("\n");
}

const size = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v) ?? "")).length;
const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const message = (e: unknown) => (e instanceof Error ? e.message : short(e));

/** One JSON line per event in `dir/agent-<time>.log`, so a stuck run can be read afterwards. */
export function runLog(dir: string): { file: string; log: Log } {
	mkdirSync(dir, { recursive: true });
	const file = path.join(dir, `agent-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
	const log: Log = (event, data) =>
		appendFileSync(file, `${JSON.stringify({ t: new Date().toISOString(), event, ...data })}\n`);
	return { file, log };
}

/**
 * The status line under the output ("waiting for model… 3s"), redrawn by
 * `tick`. Only drawn on a TTY; anything printed clears it first.
 */
class Status {
	private label = "";
	private since = 0;
	private lineStart = true;
	constructor(private out: Out) {}

	set(label: string, since = Date.now()) {
		if (label === this.label) return;
		this.label = label;
		this.since = since;
		this.tick();
	}
	tick() {
		if (!this.label || !this.out.tty || this.out.paused?.()) return;
		if (!this.lineStart) this.out.write("\n");
		this.lineStart = true;
		this.out.write(
			`\r\x1b[2K\x1b[2m${this.label} ${Math.floor((Date.now() - this.since) / 1000)}s\x1b[0m`,
		);
	}
	/** Clears the status and writes `s`; `keep` leaves the label to be redrawn on the next tick. */
	print(s: string, keep = false) {
		if (this.out.tty && this.label) this.out.write("\r\x1b[2K");
		if (!keep) this.label = "";
		if (!s) return;
		this.out.write(s);
		this.lineStart = s.endsWith("\n");
	}
	/** Prints a whole line, starting one if text was mid-line. */
	line(s: string) {
		this.print(`${this.lineStart ? "" : "\n"}${s}\n`, true);
	}
}

type Part =
	Awaited<ReturnType<typeof runAgent>["stream"]> extends AsyncIterable<infer P> ? P : never;

/**
 * Renders a run as it streams: text and visible reasoning, a timed status line
 * while waiting, each tool call's start and end, per-step usage and errors.
 * Every event also goes to `out.log`.
 */
export async function printRun(result: ReturnType<typeof runAgent>, out: Out) {
	const log = out.log ?? (() => {});
	const status = new Status(out);
	const running = new Map<string, { name: string; at: number }>();
	const t0 = Date.now();
	let step = 0;
	let stepAt = t0;
	const waiting = () => {
		const [next] = running.values();
		if (next) status.set(`running ${next.name}…`, next.at);
		else status.set("waiting for model…");
	};
	const dim = (s: string) => (out.tty ? `\x1b[2m${s}\x1b[0m` : s);
	const timer = setInterval(() => status.tick(), 1000);
	const handle = (part: Part) => {
		switch (part.type) {
			case "start-step":
				log("step-start", { step: step + 1 });
				break;
			case "reasoning-start":
				status.set("thinking…");
				break;
			case "reasoning-delta":
				// Hidden or encrypted reasoning streams empty deltas: keep the timer.
				if (part.text) status.print(dim(part.text));
				else status.set("thinking…");
				break;
			case "reasoning-end":
				waiting();
				break;
			case "text-delta":
				status.print(part.text);
				break;
			case "tool-input-start":
				status.set(`writing ${part.toolName} input…`);
				break;
			case "tool-call":
				running.set(part.toolCallId, { name: part.toolName, at: Date.now() });
				status.line(`→ ${part.toolName} ${short(part.input)}`);
				log("tool-call", { name: part.toolName, inputChars: size(part.input) });
				waiting();
				break;
			case "tool-approval-request":
				log("approval-request", { name: part.toolCall.toolName });
				break;
			case "tool-approval-response": {
				const name = part.toolCall.toolName;
				log("approval-result", { name, approved: part.approved, reason: part.reason });
				const r = running.get(part.toolCall.toolCallId);
				// The tool runs from here; the wait for the user is not its time.
				if (part.approved && r) r.at = Date.now();
				if (!part.approved) {
					running.delete(part.toolCall.toolCallId);
					status.line(`✗ ${name} ${part.reason ?? "rejected"}`);
				}
				waiting();
				break;
			}
			case "tool-result":
			case "tool-error": {
				const ms = Date.now() - (running.get(part.toolCallId)?.at ?? Date.now());
				running.delete(part.toolCallId);
				const failed = part.type === "tool-error";
				const body = failed ? message(part.error) : part.output;
				status.line(
					`${failed ? "✗" : "←"} ${part.toolName} ${secs(ms)}, ${size(body)} chars  ${short(body)}`,
				);
				log(part.type, {
					name: part.toolName,
					ms,
					chars: size(body),
					...(failed ? { error: body } : {}),
				});
				waiting();
				break;
			}
			case "finish-step":
				step++;
				status.line(
					dim(
						`[step ${step}: ${part.usage.inputTokens ?? "?"} in / ${part.usage.outputTokens ?? "?"} out, ${part.finishReason}, ${secs(Date.now() - stepAt)}]`,
					),
				);
				log("step-end", {
					step,
					usage: part.usage,
					finishReason: part.finishReason,
					ms: Date.now() - stepAt,
				});
				stepAt = Date.now();
				waiting();
				break;
			case "error":
				status.line(`[error] ${message(part.error)}`);
				log("error", { error: message(part.error) });
				break;
			case "abort":
				status.line("[stopped]");
				log("abort", { reason: part.reason });
				break;
		}
	};
	status.set("waiting for model…");
	try {
		for await (const part of result.stream) handle(part);
		const stop = result.stopped();
		if (stop) {
			status.line(`[stopped] ${stopMessage(stop)}`);
			log("limit-stop", stop);
		}
	} catch (e) {
		status.line(`[error] ${message(e)}`);
		log("error", { error: message(e) });
	} finally {
		clearInterval(timer);
		status.print("");
		log("run-end", { steps: step, ms: Date.now() - t0 });
	}
}
