import { BaseAiIntegration } from "./baseAiIntegration";

export class AnthropicIntegration extends BaseAiIntegration {
	static override variant = "Anthropic";
	static override provider = {
		name: "Anthropic",
		create: (c, fetch) =>
			(require("@ai-sdk/anthropic") as typeof import("@ai-sdk/anthropic")).createAnthropic({
				apiKey: c.apiKey,
				fetch,
			}),
		models: {
			url: () => "https://api.anthropic.com/v1/models",
			headers: (c) => ({ "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" }),
			ids: (body) => body.data.map((m: { id: string }) => m.id),
		},
	} satisfies typeof BaseAiIntegration.provider;
}
