import { BaseAiIntegration, openAiModels } from "./baseAiIntegration";
import { withExtraBody } from "./extraBody";

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
				headers: c.headers,
				transformRequestBody: withExtraBody(c.extraBody),
				fetch,
			}),
		models: openAiModels(""),
	} satisfies typeof BaseAiIntegration.provider;
}
