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

/** Track Execution's record button for production; development records by default. */
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
			Production recording · Stop
		</Button>
	) : (
		<Button
			size="sm"
			variant="primary"
			isDisabled={recording.isLoading}
			onPress={() => recording.set(true)}
		>
			<TbPlayerRecord size={16} /> Record production
		</Button>
	);
}

/**
 * Prominent indicator shown when execution recording is active.
 * Warns that capturing execution traces introduces performance overhead and is for debugging only.
 */
export function RecordingIndicator({ className }: { className?: string }) {
	return (
		<Tooltip>
			<span
				className={cn(
					"inline-flex items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-xs font-medium text-danger",
					className,
				)}
			>
				<span className="size-2 animate-pulse rounded-full bg-danger" aria-hidden />
				<span>Recording Active</span>
			</span>
			<Tooltip.Content>
				Execution recording is active. Every execution payload and trace span is captured, which
				degrades performance. For debugging only.
			</Tooltip.Content>
		</Tooltip>
	);
}
