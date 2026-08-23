import { TbBolt, TbClock, TbTools } from "react-icons/tb";

export interface HarnessUsage {
	elapsedMs?: number;
	inputTokens?: number;
	outputTokens?: number;
	toolCalls?: number;
}

function formatNumber(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
	if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
	return String(value);
}

function formatElapsed(milliseconds: number): string {
	const seconds = Math.floor(milliseconds / 1_000);
	const minutes = Math.floor(seconds / 60);
	return minutes > 0 ? `${minutes}m ${seconds % 60}s` : `${seconds}s`;
}

/** Whole-run accounting displayed beneath a completed harness response. */
export function HarnessUsageSummary({ usage }: { usage?: HarnessUsage | null }) {
	if (!usage) return null;
	const tokens = Math.max(0, usage.inputTokens ?? 0) + Math.max(0, usage.outputTokens ?? 0);

	return (
		<div className="flex items-center gap-3 px-1 text-xs font-medium text-muted">
			<span className="flex items-center gap-1"><TbClock size={14} /> {formatElapsed(usage.elapsedMs ?? 0)}</span>
			<span className="flex items-center gap-1"><TbBolt size={14} /> {formatNumber(tokens)} tokens</span>
			<span className="flex items-center gap-1"><TbTools size={14} /> {formatNumber(usage.toolCalls ?? 0)} tools</span>
		</div>
	);
}
