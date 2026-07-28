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
	const [status, setStatus] = useState<"testing" | "success" | "error" | "idle">("idle");
	const testConn = integrationsQuery.testExistingConnection.mutation(projectId);

	useEffect(() => {
		if (!value) {
			setStatus("idle");
			return;
		}
		setStatus("testing");
		testConn.mutate(value, {
			onSuccess: (res) => {
				setStatus(res.success ? "success" : "error");
			},
			onError: () => {
				setStatus("error");
			}
		});
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [value, projectId]); // Do not include testConn.mutate

	const selectedModel = models.find((m) => m.id === value);
	const dotColor =
		status === "success" ? "bg-green-500" :
		status === "error" ? "bg-red-500" :
		status === "testing" ? "bg-yellow-500" : "bg-gray-500";

	return (
		<Select
			aria-label="Model"
			variant="secondary"
			value={value}
			onChange={(v) => v && onChange(String(v as Key))}
			className="w-[240px]"
		>
			<Select.Trigger className="flex w-full h-9 items-center justify-between gap-2 rounded-2xl border border-white/10 bg-transparent px-3 font-medium text-muted-foreground shadow-none hover:bg-white/5 data-[open=true]:bg-white/5 data-[focus-visible=true]:ring-0 transition-colors">
				<Select.Value>
					<span className="flex items-center gap-2.5 overflow-hidden">
						<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
						{selectedModel && <span className="shrink-0 flex items-center">{getModelIcon(selectedModel.variant)}</span>}
						<span className="text-foreground tracking-wide text-[13.5px] truncate">{selectedModel?.name ?? "Select Model"}</span>
						{selectedModel?.isFallback && <span className="text-muted-foreground/60 text-[11px] shrink-0">• Default</span>}
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
								{m.isFallback && (
									<span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
										Default
									</span>
								)}
							</div>
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}
