import { Button, cn, Spinner, Tooltip } from "@fluxify/components";
import { TbPlayerRecord } from "react-icons/tb";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";
import { useRecordingSwitch } from "@/query/recordingsQuery";
import type { RecordingTarget } from "@/services/recordings";

export function formatRetentionNote(days?: number): string {
	const count = days ?? 30;
	return `Recordings are kept for ${count} ${count === 1 ? "day" : "days"}.`;
}

export function useRetentionNote(): string {
	const { data } = publicSettingsQuery.get.useQuery();
	return formatRetentionNote(data?.recordingMaxAgeDays);
}

export const RETENTION_NOTE = formatRetentionNote(30);

/** Track Execution's record button: development only. Production is set in the settings. */
export function RecordButton({
	projectId,
	target,
}: {
	projectId: string;
	target: RecordingTarget;
}) {
	const recording = useRecordingSwitch(projectId, target);
	if (recording.isApplying) {
		return (
			<Button size="sm" variant="outline" isDisabled>
				<Spinner size="sm" /> Applying…
			</Button>
		);
	}
	return recording.isOn ? (
		<Button size="sm" variant="outline" onPress={() => recording.set(false)}>
			<span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden />
			Development recording · Stop
		</Button>
	) : (
		<Button
			size="sm"
			variant="primary"
			isDisabled={recording.isLoading}
			onPress={() => recording.set(true)}
		>
			<TbPlayerRecord size={16} /> Record development
		</Button>
	);
}

const DOT = {
	development: "bg-accent",
	production: "bg-danger",
} as const;

/**
 * Shows which environments are recording a route or workflow: one pulsing dot per
 * environment (development accent, production danger), with a tooltip. Nothing when
 * neither is on. `compact` is the dots alone, for tight lists.
 */
export function RecordingIndicator({
	dev,
	prod,
	compact,
	className,
}: {
	dev?: boolean | null;
	prod?: boolean | null;
	compact?: boolean;
	className?: string;
}) {
	if (!dev && !prod) return null;
	const label = dev && prod ? "Recording" : dev ? "Development recording" : "Production recording";
	const detail = [
		dev && "Development runs are being recorded.",
		prod &&
			"Production runs are being recorded, which degrades performance. Prefer tracing for production.",
	]
		.filter(Boolean)
		.join(" ");
	const dots = (
		<span className="inline-flex items-center gap-1" aria-hidden>
			{dev && <span className={cn("size-2 animate-pulse rounded-full", DOT.development)} />}
			{prod && <span className={cn("size-2 animate-pulse rounded-full", DOT.production)} />}
		</span>
	);
	if (compact) {
		return (
			<span className={cn("inline-flex shrink-0", className)} title={`${label}. ${detail}`}>
				{dots}
			</span>
		);
	}
	return (
		<Tooltip>
			<span
				className={cn(
					"inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-foreground",
					className,
				)}
			>
				{dots}
				<span>{label}</span>
			</span>
			<Tooltip.Content>{detail}</Tooltip.Content>
		</Tooltip>
	);
}

/**
 * What the recording dots mean, said once for a whole list (#941): one chip in the
 * indicator's style, "Development / Production recording" with a dot before each
 * environment that records on it. Nothing when none does.
 */
export function RecordingLegend({ dev, prod }: { dev?: boolean; prod?: boolean }) {
	if (!dev && !prod) return null;
	const env = (key: keyof typeof DOT, label: string) => (
		<span className="inline-flex items-center gap-1">
			<span className={cn("size-2 rounded-full", DOT[key])} aria-hidden />
			{label}
		</span>
	);
	return (
		<span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-foreground">
			{dev && env("development", "Development")}
			{dev && prod && <span className="text-muted"> / </span>}
			{prod && env("production", "Production")}
			{/* real spaces, so it reads as words to a screen reader, not just with a gap */}
			<span> recording</span>
		</span>
	);
}
