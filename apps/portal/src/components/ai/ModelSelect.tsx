import { useEffect, useState } from "react";
import type { Key } from "@fluxify/components";
import { ListBox, Select } from "@fluxify/components";
import { integrationsQuery } from "@/query/integrationsQuery";

export type AiModel = {
	id: string;
	name: string;
	isFallback?: boolean;
};

type Props = {
	projectId: string;
	value: string;
	models: AiModel[];
	onChange: (id: string) => void;
};

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
			className="w-auto"
		>
			<Select.Trigger className="flex h-8 items-center gap-2 rounded-full border border-white/10 bg-transparent px-3 text-xs font-medium text-muted-foreground shadow-none hover:bg-white/5 data-[open=true]:bg-white/5 data-[focus-visible=true]:ring-0">
				<Select.Value>
					<span className="flex items-center gap-2">
						<span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
						<span className="text-foreground/90">{selectedModel?.name ?? "Select Model"}</span>
						<span className="text-muted-foreground/40 text-[10px]">• Default</span>
					</span>
				</Select.Value>
				<Select.Indicator />
			</Select.Trigger>
			<Select.Popover>
				<ListBox>
					{models.map((m) => (
						<ListBox.Item key={m.id} id={m.id} textValue={m.name}>
							<div className="flex w-full items-center justify-between gap-2">
								<span>{m.name}</span>
								{m.isFallback && (
									<span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[10px] text-muted-foreground">
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
