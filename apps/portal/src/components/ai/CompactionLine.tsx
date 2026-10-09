import type { Compaction } from "@fluxify/ai-gateway/src/agent/compact";
import type { ChatMessage } from "./agentMessages";

const k = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`);

/** "Context compacted: 102k → 9k tokens"; a saved summary from before the numbers were kept has just the first part. */
export const compactionText = (c?: Compaction) => {
	if (!c || c.kind === "summary")
		return c ? `Context compacted: ${k(c.before)} → ${k(c.after)} tokens` : "Context compacted";
	if (c.kind === "trim") return `Trimmed ${c.results} old tool results`;
	return `Compaction failed: ${c.error}`;
};

/** A quiet line where the context was shortened; a saved summary opens to be read. */
export function CompactionLine({ message }: { message: ChatMessage }) {
	const text = compactionText(message.compaction);
	const rule = <span className="h-px flex-1 bg-border" />;
	if (!message.summary)
		return (
			<p className="flex items-center gap-3 text-xs text-muted">
				{rule}
				{text}
				{rule}
			</p>
		);
	return (
		<details className="text-xs text-muted">
			<summary className="flex cursor-pointer list-none items-center gap-3">
				{rule}
				{text}
				{rule}
			</summary>
			<p className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-surface px-3 py-2">
				{message.summary}
			</p>
		</details>
	);
}
