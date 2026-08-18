import type { Key } from "@fluxify/components";
import { ListBox, Select } from "@fluxify/components";
import { TbChevronDown, TbHandClick, TbBolt, TbClipboardList } from "react-icons/tb";

/** Which human gates a run stops at. Mirrors `ApplyMode` in the ai-gateway. */
export type ApplyMode = "manual" | "plan" | "auto";

const MODES: Array<{
	id: ApplyMode;
	name: string;
	hint: string;
	icon: React.ReactNode;
}> = [
	{
		id: "manual",
		name: "Manual",
		hint: "Review the plan when it's risky, apply each change yourself",
		icon: <TbHandClick size={15} className="text-muted-foreground" />,
	},
	{
		id: "auto",
		name: "Auto",
		hint: "No stops — the agent plans, builds and applies everything",
		icon: <TbBolt size={15} className="text-accent" />,
	},
	{
		id: "plan",
		name: "Plan",
		hint: "Always show the plan for your approval before building",
		icon: <TbClipboardList size={15} className="text-muted-foreground" />,
	},
];

type Props = {
	value: ApplyMode;
	onChange: (mode: ApplyMode) => void;
};

export function ApplyModeSelect({ value, onChange }: Props) {
	const selected = MODES.find((m) => m.id === value) ?? MODES[0];

	return (
		<Select
			aria-label="Apply mode"
			variant="secondary"
			value={value}
			onChange={(v) => v && onChange(String(v as Key) as ApplyMode)}
			className="w-[120px]"
		>
			<Select.Trigger className="flex w-full h-9 items-center justify-between gap-2 rounded-2xl border border-border bg-transparent px-3 font-medium text-muted shadow-none hover:bg-surface-secondary data-[open=true]:bg-surface-secondary data-[focus-visible=true]:ring-0 transition-colors">
				<Select.Value>
					<span className="flex items-center gap-2.5 overflow-hidden">
						<span className="shrink-0 flex items-center">{selected.icon}</span>
						<span className="text-foreground tracking-wide text-[13.5px] truncate">
							{selected.name}
						</span>
					</span>
				</Select.Value>
				<Select.Indicator>
					<TbChevronDown size={14} className="text-muted-foreground ml-1 shrink-0" />
				</Select.Indicator>
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{MODES.map((m) => (
						<ListBox.Item key={m.id} id={m.id} textValue={m.name}>
							<div className="flex w-full flex-col gap-0.5 py-0.5">
								<div className="flex items-center gap-2.5">
									{m.icon}
									<span className="text-[13.5px] font-medium tracking-wide text-foreground/90">
										{m.name}
									</span>
								</div>
								<span className="pl-[25px] text-[12px] text-muted">{m.hint}</span>
							</div>
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}
