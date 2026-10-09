import type { StopReason } from "@fluxify/ai-gateway/src/agent/agent";
import { Spinner } from "@fluxify/components";
import { useEffect, useState } from "react";
import { TbAlertTriangle, TbBan, TbCheck, TbClock, TbX } from "react-icons/tb";
import {
	type ChatMessage,
	type Part,
	type ReasoningPart,
	type ToolPart,
	toolTitle,
} from "./agentMessages";
import { CompactionLine } from "./CompactionLine";
import { MarkdownViewer } from "./MarkdownViewer";
import { UserMessage } from "./UserMessage";

const json = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v, null, 2) ?? ""));
const short = (v: unknown) => {
	const s = typeof v === "string" ? v : (JSON.stringify(v) ?? "");
	return s.length > 80 ? `${s.slice(0, 80)}…` : s;
};
const done = (t: ToolPart) =>
	t.status !== undefined || t.output !== undefined || t.error !== undefined;

/** One tool call, folded: name, short input, duration; open for the input and result. */
function ToolRow({
	tool,
	waiting,
	running,
}: {
	tool: ToolPart;
	waiting: boolean;
	running: boolean;
}) {
	const asking = !done(tool) && (tool.approval || waiting);
	const ms = tool.startedAt && tool.endedAt ? tool.endedAt - tool.startedAt : undefined;
	return (
		<details className="group rounded-lg border border-border bg-surface text-xs">
			<summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-1.5">
				{tool.status === "rejected" ? (
					<TbBan size={14} aria-label="Rejected" className="shrink-0 text-muted" />
				) : tool.status === "error" || tool.error !== undefined ? (
					<TbX size={14} aria-label="Failed" className="shrink-0 text-danger" />
				) : done(tool) ? (
					<TbCheck size={14} aria-label="Done" className="shrink-0 text-success" />
				) : asking ? (
					<TbClock size={14} className="shrink-0 text-warning" />
				) : running ? (
					<Spinner size="sm" color="current" />
				) : (
					<TbX size={14} className="shrink-0 text-muted" />
				)}
				<span className="font-medium text-foreground">{toolTitle(tool)}</span>
				<span className="min-w-0 flex-1 truncate font-mono text-muted">{short(tool.input)}</span>
				{ms !== undefined && <span className="shrink-0 text-muted">{(ms / 1000).toFixed(1)}s</span>}
			</summary>
			<div className="flex flex-col gap-2 border-t border-border px-3 py-2">
				<pre className="max-h-64 overflow-auto whitespace-pre-wrap text-muted">
					{json(tool.input)}
				</pre>
				{tool.error !== undefined && (
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap text-danger">{tool.error}</pre>
				)}
				{tool.output !== undefined && (
					<pre className="max-h-64 overflow-auto whitespace-pre-wrap text-foreground/80">
						{json(tool.output)}
					</pre>
				)}
			</div>
		</details>
	);
}

/** Under a second is a replayed burst or a blink: no time. */
const thoughtLabel = (ms?: number) =>
	ms !== undefined && ms >= 1000 ? `Thought for ${Math.round(ms / 1000)}s` : "Thought";

/** Reasoning, dimmed and folded, with the time that model call thought. Hidden (encrypted) reasoning has no text. */
function Reasoning({ part }: { part: ReasoningPart }) {
	const { text } = part;
	const [open, setOpen] = useState(false);
	return (
		<details
			className="text-xs text-muted"
			open={open}
			onToggle={(e) => setOpen(e.currentTarget.open)}
		>
			<summary className="cursor-pointer list-none">
				{text ? thoughtLabel(part.ms) : `${thoughtLabel(part.ms)} (hidden)`}
			</summary>
			{text && (
				<>
					<p className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-3">{text}</p>
					{/* long thinking puts the top toggle far away */}
					<button
						type="button"
						className="mt-1 cursor-pointer text-muted underline-offset-2 hover:underline"
						onClick={() => setOpen(false)}
					>
						Collapse
					</button>
				</>
			)}
		</details>
	);
}

function PartView({ part, waiting, running }: { part: Part; waiting: boolean; running: boolean }) {
	if (part.type === "text") return part.text ? <MarkdownViewer content={part.text} /> : null;
	if (part.type === "reasoning") return <Reasoning part={part} />;
	return <ToolRow tool={part} waiting={waiting} running={running} />;
}

export function AgentMessage({
	message,
	waiting,
	running,
}: {
	message: ChatMessage;
	/** The run waits for an approval: a call without a result is the one. */
	waiting: boolean;
	running: boolean;
}) {
	if (message.role === "compaction") return <CompactionLine message={message} />;
	if (message.role === "user")
		return (
			<UserMessage query={message.parts.map((p) => (p.type === "text" ? p.text : "")).join("")} />
		);
	return (
		<div className="flex w-full flex-col gap-2">
			{message.parts.map((p, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: parts only ever append
				<PartView key={i} part={p} waiting={waiting} running={running} />
			))}
		</div>
	);
}

/** `Thinking… 3s` since this model call began, while the model works without showing text. */
export function Thinking({ since }: { since: number }) {
	const [now, setNow] = useState(Date.now());
	useEffect(() => {
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, []);
	return (
		<p className="animate-pulse text-xs text-muted">
			Thinking… {Math.max(0, Math.round((now - since) / 1000))}s
		</p>
	);
}

const LIMITS: Record<StopReason, string> = {
	step_limit: "The agent stopped at its step limit.",
	token_budget: "The agent stopped at its token budget.",
	restarted: "The server restarted during this run.",
};

/** Like a usage limit notice: the run ended early; a new message goes on. */
export function LimitNotice({ reason }: { reason: StopReason }) {
	return (
		<div className="flex items-center gap-2 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-foreground">
			<TbAlertTriangle size={16} className="shrink-0 text-warning" />
			<span>
				{LIMITS[reason]} <span className="text-muted">Send a message to continue.</span>
			</span>
		</div>
	);
}
