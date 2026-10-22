import { Tooltip } from "@fluxify/components";
import { useEffect, useState } from "react";
import { TbClockPause } from "react-icons/tb";
import { CACHE_COLD_AFTER_MS, isCacheCold } from "./cacheIdle";

export const COLD_CACHE_COPY = `No messages for over ${CACHE_COLD_AFTER_MS / 60_000} minutes, so the AI provider has likely dropped its cached copy of this conversation. Your next message sends the whole history again without that cache: it uses more tokens and may take longer to answer.`;

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
		<Tooltip delay={200}>
			{/* the trigger is what opens it, on hover and on keyboard focus */}
			<Tooltip.Trigger
				aria-label={COLD_CACHE_COPY}
				className="inline-flex cursor-help items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-muted"
			>
				<TbClockPause size={13} />
				<span>Idle chat</span>
			</Tooltip.Trigger>
			<Tooltip.Content className="max-w-xs">{COLD_CACHE_COPY}</Tooltip.Content>
		</Tooltip>
	);
}
