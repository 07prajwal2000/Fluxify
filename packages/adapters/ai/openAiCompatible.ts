import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { BaseAiIntegration, openAiModels } from "./baseAiIntegration";

export class OpenAICompatibleIntegration extends BaseAiIntegration {
	static override variant = "OpenAI Compatible";
	static override provider = {
		name: "OpenAI Compatible",
		create: (c, fetch) =>
			createOpenAICompatible({
				name: "openai-compatible",
				baseURL: c.baseUrl!,
				apiKey: c.apiKey,
				fetch,
			}),
		models: openAiModels(""),
	} satisfies typeof BaseAiIntegration.provider;
}
