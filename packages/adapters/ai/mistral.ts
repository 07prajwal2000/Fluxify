import { BaseAiIntegration, openAiModels } from "./baseAiIntegration";

const BASE_URL = "https://api.mistral.ai/v1";

/** Mistral's API is OpenAI-compatible: the compatible client at Mistral's URL, kept as a variant for stored rows */
export class MistralIntegration extends BaseAiIntegration {
	static override variant = "Mistral";
	static override provider = {
		name: "Mistral",
		create: (c, fetch) =>
			(
				require("@ai-sdk/openai-compatible") as typeof import("@ai-sdk/openai-compatible")
			).createOpenAICompatible({ name: "mistral", baseURL: BASE_URL, apiKey: c.apiKey, fetch }),
		models: openAiModels(BASE_URL),
	} satisfies typeof BaseAiIntegration.provider;
}
