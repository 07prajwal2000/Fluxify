import { useEffect, useState } from "react";
import { TbArrowDown, TbArrowUp } from "react-icons/tb";
import { useConversationRun } from "@/store/aiHarness";

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

/** Compact live counters for current harness run. */
export function HarnessLiveStats({ conversationId }: { conversationId: string }) {
	const run = useConversationRun(conversationId);
	const stats = run?.stats;
	const [now, setNow] = useState(Date.now());

	useEffect(() => {
		if (!stats || run?.isTerminal) return;
		const interval = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => window.clearInterval(interval);
	}, [stats, run?.isTerminal]);

	const isVisible = stats && !run?.isTerminal;
	const elapsedMs = stats ? stats.elapsedMs + Math.max(0, now - (run.statsReceivedAt ?? now)) : 0;

	return (
		<div className={`mx-auto mb-2 flex w-full max-w-[65%] items-center justify-center gap-2 text-xs font-medium tracking-wide transition-opacity duration-300 ${isVisible ? 'opacity-100 text-muted' : 'opacity-0 pointer-events-none'}`}>
			TOOL CALLS: {formatNumber(stats?.toolCalls ?? 0)} <span aria-hidden="true">|</span>{" "}
			TIME ELAPSED: {formatElapsed(elapsedMs)} <span aria-hidden="true">|</span>{" "}
			<span>TOKENS:</span>
			<span className="flex items-center gap-0.5" title="Input tokens"><TbArrowUp size={14} /> {formatNumber(stats?.inputTokens ?? 0)}</span>
			<span className="flex items-center gap-0.5" title="Output tokens"><TbArrowDown size={14} /> {formatNumber(stats?.outputTokens ?? 0)}</span>
		</div>
	);
}
