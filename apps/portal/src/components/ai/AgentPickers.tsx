import { CustomSelect } from "@fluxify/components";
import type { Effort, Mode } from "@/services/agentConversations";

const MODES: { value: Mode; label: string }[] = [
	{ value: "manual", label: "Manual" },
	{ value: "auto", label: "Auto" },
	{ value: "plan", label: "Plan" },
];
const EFFORTS: { value: Effort; label: string }[] = [
	{ value: "none", label: "No thinking" },
	{ value: "low", label: "Low" },
	{ value: "mid", label: "Mid" },
	{ value: "high", label: "High" },
];

export const NO_THINKING = "This model doesn't support thinking";

const TRIGGER = "h-8 min-h-8 w-auto min-w-24 text-xs";

type Props = {
	mode: Mode;
	onModeChange: (mode: Mode) => void;
	effort: Effort;
	onEffortChange: (effort: Effort) => void;
	/** The project's model takes a thinking setting; false disables the effort picker. */
	supportsThinking: boolean;
};

/**
 * Next to the prompt editor. Manual asks before every change, Auto only before
 * deletes, Plan only reads and writes a plan to start. Effort is how hard the
 * model thinks first, where the model can.
 */
export function AgentPickers({
	mode,
	onModeChange,
	effort,
	onEffortChange,
	supportsThinking,
}: Props) {
	return (
		<div className="flex shrink-0 items-center gap-1">
			<CustomSelect
				aria-label="Mode"
				className={TRIGGER}
				options={MODES}
				value={mode}
				onChange={(v) => onModeChange(v as Mode)}
			/>
			{/* a disabled control sends no hover, so the reason sits on its wrapper */}
			<div title={supportsThinking ? undefined : NO_THINKING}>
				<CustomSelect
					aria-label="Thinking effort"
					className={TRIGGER}
					options={EFFORTS}
					value={supportsThinking ? effort : "none"}
					isDisabled={!supportsThinking}
					onChange={(v) => onEffortChange(v as Effort)}
				/>
			</div>
		</div>
	);
}
