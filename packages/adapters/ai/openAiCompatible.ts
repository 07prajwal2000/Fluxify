import { BaseAiIntegration, openAiModels } from "./baseAiIntegration";

export class OpenAICompatibleIntegration extends BaseAiIntegration {
	static override variant = "OpenAI Compatible";
	static override provider = {
		name: "OpenAI Compatible",
		create: (c, fetch) =>
			(
				require("@ai-sdk/openai-compatible") as typeof import("@ai-sdk/openai-compatible")
			).createOpenAICompatible({
				name: "openai-compatible",
				baseURL: c.baseUrl!,
				apiKey: c.apiKey,
				fetch,
			}),
		models: openAiModels(""),
	} satisfies typeof BaseAiIntegration.provider;
}
