import { Description, Input, Label, TextField } from "@fluxify/components";
import { TbAlertTriangle, TbClock } from "react-icons/tb";
import { useDebounce } from "@/hooks/useDebounce";
import { triggersQuery } from "@/query/triggersQuery";

/**
 * The schedule half of the trigger form.
 *
 * A plain text field, deliberately. A visual cron picker can only express the
 * schedules its designer thought of, and the people who write cron already know
 * the syntax — what they actually need is confirmation that the expression they
 * typed means what they think. That is what the preview below is for.
 */

export type ScheduleValue = { schedule: string; timezone: string };

/** Suggestions, not a fixed menu — the field takes any valid expression. */
const EXAMPLES = [
	{ spec: "@every 5m", label: "Every 5 minutes" },
	{ spec: "0 0 9 * * 1-5", label: "Weekdays at 09:00" },
	{ spec: "@daily", label: "Midnight" },
	{ spec: "0 0 3 1 * *", label: "1st of the month, 03:00" },
];

export function ScheduleFields({
	value,
	onChange,
	isDisabled,
}: {
	value: ScheduleValue;
	onChange: (value: ScheduleValue) => void;
	isDisabled?: boolean;
}) {
	// Previewing on every keystroke would ask the server to parse half-typed
	// expressions constantly, and the answer only matters once typing pauses.
	const debounced = useDebounce(value, 350);
	const preview = triggersQuery.schedulePreview.useQuery(
		debounced.schedule,
		debounced.timezone,
	);
	const nonUtc = value.timezone.trim() !== "" && value.timezone !== "UTC";

	return (
		<div className="flex flex-col gap-4">
			<TextField
				isRequired
				value={value.schedule}
				onChange={(schedule) => onChange({ ...value, schedule })}
				isDisabled={isDisabled}
			>
				<Label>Schedule</Label>
				<Input placeholder="0 0 9 * * 1-5" className="font-mono" />
				<Description>
					Six fields — seconds, minutes, hours, day of month, month, day of week
					— or <code>@every 30m</code>, <code>@daily</code>, or{" "}
					<code>@at 2026-01-01T09:00:00Z</code> to run once.
				</Description>
			</TextField>

			<div className="flex flex-wrap gap-1.5">
				{EXAMPLES.map((example) => (
					<button
						key={example.spec}
						type="button"
						disabled={isDisabled}
						onClick={() => onChange({ ...value, schedule: example.spec })}
						className="rounded-md border border-border bg-surface px-2 py-1 font-mono text-xs text-muted transition-colors hover:border-accent hover:text-foreground disabled:opacity-50"
						title={example.label}
					>
						{example.spec}
					</button>
				))}
			</div>

			<TextField
				value={value.timezone}
				onChange={(timezone) => onChange({ ...value, timezone })}
				isDisabled={isDisabled}
			>
				<Label>Timezone</Label>
				<Input placeholder="UTC" />
				<Description>
					An IANA name like <code>Asia/Kolkata</code>. Applies to cron
					expressions only.
				</Description>
			</TextField>

			{nonUtc && (
				<p className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
					<TbAlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
					<span>
						Clocks in {value.timezone} may move for daylight saving. A time that
						is skipped that day does not run, and a time that repeats runs
						twice. UTC never does either.
					</span>
				</p>
			)}

			<SchedulePreview
				spec={debounced.schedule}
				pending={preview.isFetching}
				error={preview.error}
				data={preview.data}
			/>
		</div>
	);
}

/**
 * The next five fires, which is the only honest answer to "did I write that
 * right?". An error here is a message from the same validator that will reject
 * the save, so the user reads it before they submit rather than after.
 */
function SchedulePreview({
	spec,
	pending,
	error,
	data,
}: {
	spec: string;
	pending: boolean;
	error: unknown;
	data?: { description: string; nextFires: string[] };
}) {
	if (!spec.trim()) return null;
	if (error)
		return (
			<p className="text-xs text-danger">
				{(error as { message?: string })?.message ?? "Not a valid schedule"}
			</p>
		);
	if (!data)
		return <p className="text-xs text-muted">{pending ? "Checking…" : null}</p>;

	return (
		<div className="rounded-md border border-border bg-surface p-3">
			<p className="flex items-center gap-1.5 text-xs font-medium text-foreground">
				<TbClock size={14} className="text-accent" />
				{data.description}
			</p>
			{data.nextFires.length === 0 ? (
				<p className="mt-2 text-xs text-warning">
					This never fires — the time it names has already passed.
				</p>
			) : (
				<ul className="mt-2 flex flex-col gap-0.5">
					{data.nextFires.map((at) => (
						<li key={at} className="font-mono text-xs text-muted">
							{new Date(at).toLocaleString()}
						</li>
					))}
				</ul>
			)}
			<p className="mt-2 text-[11px] text-muted">
				Shown in your browser's timezone.
			</p>
		</div>
	);
}
