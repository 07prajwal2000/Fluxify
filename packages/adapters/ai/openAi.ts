import { createOpenAI } from "@ai-sdk/openai";
import { BaseAiIntegration, openAiModels } from "./baseAiIntegration";

export class OpenAIIntegration extends BaseAiIntegration {
	static override variant = "OpenAI";
	static override provider = {
		name: "OpenAI",
		create: (c, fetch) => createOpenAI({ apiKey: c.apiKey, fetch }),
		models: openAiModels("https://api.openai.com/v1"),
	} satisfies typeof BaseAiIntegration.provider;
}
