import { cn, Tooltip } from "@fluxify/components";

const BASE = "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium";
const TONES = {
	on: "border-success/40 bg-success/10 text-success",
	/** switched on for production, but nothing promoted to serve */
	pending: "border-warning/40 bg-warning/10 text-warning",
	off: "border-border bg-surface text-muted",
};

type EnvStatusChipsProps = {
	/** `active`: production's switch. Omit where there is no production, as for a sandbox's trigger. */
	prod?: boolean;
	/** `devActive`: development's switch */
	dev: boolean;
	/** Whether production has a promoted version to serve; omit where there are no versions. */
	promoted?: boolean;
};

/**
 * Where an item is switched on, one chip per environment (#1064). Each
 * environment has its own switch (#738), so one Active toggle in a table was
 * misleading; the switches themselves live in the item's settings.
 */
export function EnvStatusChips({ prod, dev, promoted }: EnvStatusChipsProps) {
	const waiting = prod && promoted === false;
	return (
		<div className="flex items-center gap-1.5">
			{prod !== undefined && (
				<EnvChip
					label="Prod"
					tone={waiting ? "pending" : prod ? "on" : "off"}
					description={
						waiting
							? "Production: enabled, but no version is promoted yet"
							: `Production: ${prod ? "enabled" : "disabled"}`
					}
				/>
			)}
			<EnvChip
				label="Dev"
				tone={dev ? "on" : "off"}
				description={`Development: ${dev ? "enabled" : "disabled"}`}
			/>
		</div>
	);
}

function EnvChip({
	label,
	tone,
	description,
}: {
	label: string;
	tone: keyof typeof TONES;
	description: string;
}) {
	return (
		<Tooltip delay={200}>
			<Tooltip.Trigger
				render={(props) => (
					<span {...props} role="img" aria-label={description} className={cn(BASE, TONES[tone])} />
				)}
			>
				<span
					aria-hidden
					className={cn("size-1.5 rounded-full bg-current", tone === "off" && "opacity-40")}
				/>
				{label}
			</Tooltip.Trigger>
			<Tooltip.Content className="whitespace-nowrap">{description}</Tooltip.Content>
		</Tooltip>
	);
}
