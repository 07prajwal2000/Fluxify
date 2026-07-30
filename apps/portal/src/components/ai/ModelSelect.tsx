import { useEffect, useState } from "react";
import type { Key } from "@fluxify/components";
import { ListBox, Select } from "@fluxify/components";
import { integrationsQuery } from "@/query/integrationsQuery";
import { TbChevronDown, TbSparkles } from "react-icons/tb";
import { RiGeminiFill, RiOpenaiLine, RiRobot2Fill, RiOpenaiFill } from "react-icons/ri";
import { SiAnthropic } from "react-icons/si";

export type AiModel = {
	id: string;
	name: string;
	variant?: string;
	isFallback?: boolean;
};

type Props = {
	projectId: string;
	value: string;
	models: AiModel[];
	onChange: (id: string) => void;
};

function getModelIcon(variant?: string) {
	if (variant === "Anthropic") return <SiAnthropic size={15} className="text-[#d97757]" />;
	if (variant === "OpenAI") return <RiOpenaiFill size={15} className="text-[#10a37f]" />;
	if (variant === "Gemini") return <RiGeminiFill size={15} className="text-[#4285f4]" />;
	if (variant === "Mistral") return <RiRobot2Fill size={15} className="text-[#fca03e]" />;
	if (variant === "OpenAI Compatible") return <RiOpenaiLine size={15} className="text-muted-foreground" />;
	return <TbSparkles size={15} className="text-muted-foreground" />;
}

export function ModelSelect({ projectId, value, models, onChange }: Props) {
	const selectedModel = models.find((m) => m.id === value);

	return (
		<Select
			aria-label="Model"
			variant="secondary"
			value={value}
			onChange={(v) => v && onChange(String(v as Key))}
			className="w-[240px]"
		>
			<Select.Trigger className="flex w-full h-9 items-center justify-between gap-2 rounded-2xl border border-white/10 bg-transparent px-3 font-medium text-muted-foreground shadow-none hover:bg-white/5 data-[open=true]:bg-white/5 data-[focus-visible=true]:ring-0 transition-colors relative">
				{!value && (
					<span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
						<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
						<span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
					</span>
				)}
				<Select.Value>
					<span className="flex items-center gap-2.5 overflow-hidden">
						{selectedModel && <span className="shrink-0 flex items-center">{getModelIcon(selectedModel.variant)}</span>}
						<span className="text-foreground tracking-wide text-[13.5px] truncate">{selectedModel?.name ?? "Select Model"}</span>
					</span>
				</Select.Value>
				<Select.Indicator>
					<TbChevronDown size={14} className="text-muted-foreground ml-1 shrink-0" />
				</Select.Indicator>
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{models.map((m) => (
						<ListBox.Item key={m.id} id={m.id} textValue={m.name}>
							<div className="flex w-full items-center justify-between gap-4 py-0.5">
								<div className="flex items-center gap-2.5">
									{getModelIcon(m.variant)}
									<span className="text-[13.5px] font-medium tracking-wide text-foreground/90">{m.name}</span>
								</div>
							</div>
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}
