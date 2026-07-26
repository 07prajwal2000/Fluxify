import { Input, Label } from "@fluxify/components";
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
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<Label>Name *</Label>
				<span className="text-xs text-muted">Unique Name for the integration</span>
				<Input value={name} onChange={(e) => onName(e.currentTarget.value)} placeholder="name" />
			</div>

			{showBaseUrl && (
				<AppConfigSelector
					projectId={projectId}
					value={(config.baseUrl as string) ?? ""}
					onChange={(v) => setField("baseUrl", v)}
					label="Base URL"
					description="Base URL for the AI"
					placeholder="https://api.openai.com/v1"
				/>
			)}
			<AppConfigSelector
				projectId={projectId}
				value={(config.apiKey as string) ?? ""}
				onChange={(v) => setField("apiKey", v)}
				label="API Key"
				description="API Key for the AI"
				placeholder="api-key"
			/>
			<div className="flex flex-col gap-1">
				<Label>Model *</Label>
				<span className="text-xs text-muted">Model for the AI</span>
				<Input
					value={(config.model as string) ?? ""}
					onChange={(e) => setField("model", e.currentTarget.value)}
					placeholder="model-name"
				/>
			</div>
		</div>
	);
}
