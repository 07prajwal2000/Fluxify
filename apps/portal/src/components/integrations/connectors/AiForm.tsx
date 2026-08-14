import { Input } from "@fluxify/components";
import { AppConfigSelector } from "../AppConfigSelector";
import type { ConnectorFormProps } from "./types";

// OpenAI / Anthropic / Gemini / Mistral / OpenAI-Compatible (showBaseUrl).
export function AiForm({
	projectId,
	name,
	onName,
	config,
	setField,
	showBaseUrl = false,
}: ConnectorFormProps & { showBaseUrl?: boolean }) {
	return (
		<div className="flex flex-col gap-3.5">
			<div className="flex flex-col gap-1">
				<label className="text-xs font-medium text-zinc-300">
					Integration Name <span className="text-[#D0F237]">*</span>
				</label>
				<Input value={name} onChange={(e) => onName(e.currentTarget.value)} placeholder="e.g. Production OpenAI" />
			</div>

			{showBaseUrl && (
				<AppConfigSelector
					projectId={projectId}
					value={(config.baseUrl as string) ?? ""}
					onChange={(v) => setField("baseUrl", v)}
					label="Base URL"
					placeholder="https://api.openai.com/v1"
				/>
			)}
			<AppConfigSelector
				projectId={projectId}
				value={(config.apiKey as string) ?? ""}
				onChange={(v) => setField("apiKey", v)}
				label="API Key"
				placeholder="sk-..."
			/>
			<div className="flex flex-col gap-1">
				<label className="text-xs font-medium text-zinc-300">
					Model <span className="text-[#D0F237]">*</span>
				</label>
				<Input
					value={(config.model as string) ?? ""}
					onChange={(e) => setField("model", e.currentTarget.value)}
					placeholder="e.g. gpt-4o, claude-3-5-sonnet, gemini-1.5-pro"
				/>
			</div>
		</div>
	);
}
