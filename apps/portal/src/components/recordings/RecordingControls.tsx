import { Button, Spinner, Switch } from "@fluxify/components";
import { TbPlayerRecord } from "react-icons/tb";
import { useRecordingSwitch } from "@/query/recordingsQuery";
import type { RecordingTarget } from "@/services/recordings";

/** retention is an instance setting the portal cannot read, so say the default */
export const RETENTION_NOTE =
	"Recordings are kept for 30 days by default (your instance may set a different limit).";

/** Track Execution's record button: a live dot while recording is on. */
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
			Recording · Stop
		</Button>
	) : (
		<Button
			size="sm"
			variant="primary"
			isDisabled={recording.isLoading}
			onPress={() => recording.set(true)}
		>
			<TbPlayerRecord size={16} /> Record
		</Button>
	);
}

/** The settings-modal switch. Applies on its own (it recompiles), not with Save. */
export function RecordingSwitch({
	projectId,
	target,
	readOnly,
}: {
	projectId: string;
	target: RecordingTarget;
	readOnly: boolean;
}) {
	const recording = useRecordingSwitch(projectId, target);
	return (
		<div className="flex items-center gap-2">
			<Switch
				isSelected={recording.isOn}
				onChange={recording.set}
				isDisabled={readOnly || recording.isLoading || recording.isApplying}
				label={
					recording.isApplying ? "Applying…" : recording.isOn ? "Recording on" : "Recording off"
				}
			/>
			{recording.isApplying && <Spinner size="sm" />}
		</div>
	);
}
