import { Input } from "@fluxify/components";
import { AppConfigSelector } from "../AppConfigSelector";
import { HeadersEditor } from "../HeadersEditor";
import { ExtraBodyField } from "./ExtraBodyField";
import type { ConnectorFormProps } from "./types";

// OpenAI / Anthropic / Gemini / Mistral / OpenAI-Compatible (showBaseUrl).
export function AiForm({
	projectId,
	name,
	onName,
	config,
	setField,
	hideName = false,
	showBaseUrl = false,
}: ConnectorFormProps & { showBaseUrl?: boolean }) {
	return (
		<div className="flex flex-col gap-3.5">
			{!hideName && (
				<div className="flex flex-col gap-1">
					<label htmlFor="ai-integration-name" className="text-xs font-medium text-foreground">
						Integration Name <span className="text-danger">*</span>
					</label>
					<Input
						id="ai-integration-name"
						value={name}
						onChange={(e) => onName(e.currentTarget.value)}
						placeholder="e.g. Production OpenAI"
					/>
				</div>
			)}

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
				label={showBaseUrl ? "API Key (optional)" : "API Key"}
				placeholder="sk-..."
			/>
			<div className="flex flex-col gap-1">
				<label htmlFor="ai-model" className="text-xs font-medium text-foreground">
					Model <span className="text-danger">*</span>
				</label>
				<Input
					id="ai-model"
					value={(config.model as string) ?? ""}
					onChange={(e) => setField("model", e.currentTarget.value)}
					placeholder="e.g. gpt-4o, claude-3-5-sonnet, gemini-1.5-pro"
				/>
			</div>
			<HeadersEditor
				projectId={projectId}
				value={config.headers as Record<string, string> | undefined}
				onChange={(headers) => setField("headers", headers)}
				description="Sent with every request to the provider, e.g. for a gateway or proxy"
			/>
			{showBaseUrl && (
				<ExtraBodyField
					value={config.extraBody as Record<string, unknown> | undefined}
					onChange={(body) => setField("extraBody", body)}
				/>
			)}
		</div>
	);
}
