import { Tooltip } from "@fluxify/components";
import { useEffect, useState } from "react";
import { formatAbsoluteTime, formatRelativeTime } from "./time";

/**
 * Relative recording timestamp with finer-grained near-term steps
 * and an absolute date/time tooltip on hover.
 */
export function RecordingTime({
	timestamp,
	className,
}: {
	timestamp: unknown;
	className?: string;
}) {
	const [now, setNow] = useState(() => Date.now());

	useEffect(() => {
		if (!timestamp) return;
		const date = new Date(timestamp as string);
		if (Number.isNaN(date.getTime())) return;

		let timer: ReturnType<typeof setTimeout>;

		const tick = () => {
			const current = Date.now();
			setNow(current);
			const elapsed = current - date.getTime();
			const delay =
				elapsed < 60_000
					? Math.max(100, 1000 - (elapsed % 1000))
					: Math.max(1_000, 30_000 - (elapsed % 30_000));
			timer = setTimeout(tick, delay);
		};

		const elapsed = Date.now() - date.getTime();
		const delay =
			elapsed < 60_000
				? Math.max(100, 1000 - (elapsed % 1000))
				: Math.max(1_000, 30_000 - (elapsed % 30_000));
		timer = setTimeout(tick, delay);

		return () => clearTimeout(timer);
	}, [timestamp]);

	const relative = formatRelativeTime(timestamp, now);
	const absolute = formatAbsoluteTime(timestamp);

	if (!absolute) {
		return <span className={className}>{relative}</span>;
	}

	return (
		<Tooltip delay={200}>
			<Tooltip.Trigger render={(props) => <span {...props} className={className} />}>
				{relative}
			</Tooltip.Trigger>
			<Tooltip.Content className="whitespace-nowrap">{absolute}</Tooltip.Content>
		</Tooltip>
	);
}
