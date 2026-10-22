import { Tooltip } from "@fluxify/components";
import { useEffect, useState } from "react";
import { TbClockPause } from "react-icons/tb";
import { isCacheCold } from "./cacheIdle";

export const COLD_CACHE_COPY =
	"This chat has been idle. The next message re-reads the history at full cost and may be slower.";

/**
 * A chip at the chatbox's top right once the chat has idled past the prompt cache's
 * lifetime. Estimated from the clock: providers only report cache hits after a call.
 */
export function ColdCacheHint({
	lastCallAt,
	running,
}: {
	lastCallAt: number | null;
	running: boolean;
}) {
	// re-check each minute, so the hint appears on a tab left open
	const [now, setNow] = useState(Date.now);
	useEffect(() => {
		const timer = window.setInterval(() => setNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);

	if (!isCacheCold(lastCallAt, now, running)) return null;
	return (
		<Tooltip>
			<span
				role="note"
				aria-label={COLD_CACHE_COPY}
				className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted"
			>
				<TbClockPause size={13} />
				<span>Idle chat</span>
			</span>
			<Tooltip.Content>{COLD_CACHE_COPY}</Tooltip.Content>
		</Tooltip>
	);
}
