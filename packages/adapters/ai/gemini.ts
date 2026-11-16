import { BaseAiIntegration } from "./baseAiIntegration";

export class GeminiIntegration extends BaseAiIntegration {
	static override variant = "Gemini";
	static override provider = {
		name: "Gemini",
		create: (c, fetch) =>
			(require("@ai-sdk/google") as typeof import("@ai-sdk/google")).createGoogle({
				apiKey: c.apiKey,
				headers: c.headers,
				fetch,
			}),
		models: {
			url: () => "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000",
			headers: (c) => ({ "x-goog-api-key": c.apiKey }),
			// `models/gemini-2.5-flash` -> the id the AI SDK takes
			ids: (body) => body.models.map((m: { name: string }) => m.name.replace(/^models\//, "")),
			info: (body) =>
				body.models.map((m: { name: string; displayName?: string; inputTokenLimit?: number }) => ({
					id: m.name.replace(/^models\//, ""),
					...(m.displayName && { name: m.displayName }),
					...(m.inputTokenLimit && { contextLength: m.inputTokenLimit }),
				})),
		},
	} satisfies typeof BaseAiIntegration.provider;
}
