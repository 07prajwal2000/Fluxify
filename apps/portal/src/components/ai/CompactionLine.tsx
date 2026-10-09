import { compactionText } from "@fluxify/ai-gateway/src/agent/compactStats";
import type { ChatMessage } from "./agentMessages";

/** A quiet line where the context was shortened; a saved summary opens to be read. */
export function CompactionLine({ message }: { message: ChatMessage }) {
	// a summary saved before the numbers were kept has no stats
	const text = message.compaction ? compactionText(message.compaction) : "Context compacted";
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
