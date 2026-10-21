import type { IntegrationOpContext } from "@fluxify/sdk/integrations";
import { AnthropicIntegration } from "../../ai/anthropic";
import { GeminiIntegration } from "../../ai/gemini";
import { MistralIntegration } from "../../ai/mistral";
import { OpenAIIntegration } from "../../ai/openAi";
import { OpenAICompatibleIntegration } from "../../ai/openAiCompatible";

type Probe = {
	TestConnection(config: any, appConfigs: Map<string, string>): Promise<boolean>;
};

/** One prompt to the model; a provider's refusal throws and is reported by the caller. */
const test = (provider: Probe, name: string) => ({
	async test(config: any, ctx: IntegrationOpContext) {
		if (!(await provider.TestConnection(config, ctx.appConfig))) {
			return { success: false, error: `Failed to connect to ${name}` };
		}
		return { success: true, error: "" };
	},
});

export const AI_OPS = {
	"ai/OpenAI": test(OpenAIIntegration, "OpenAI"),
	"ai/Anthropic": test(AnthropicIntegration, "Anthropic"),
	"ai/Gemini": test(GeminiIntegration, "Gemini"),
	"ai/Mistral": test(MistralIntegration, "Mistral"),
	"ai/OpenAI Compatible": test(OpenAICompatibleIntegration, "OpenAI Compatible"),
};
