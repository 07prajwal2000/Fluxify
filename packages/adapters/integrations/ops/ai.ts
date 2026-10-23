import type { AiInspectResult, IntegrationOpContext } from "@fluxify/sdk/integrations";
import { AnthropicIntegration } from "../../ai/anthropic";
import type { BaseAiIntegration } from "../../ai/baseAiIntegration";
import { GeminiIntegration } from "../../ai/gemini";
import { MistralIntegration } from "../../ai/mistral";
import { OpenAIIntegration } from "../../ai/openAi";
import { OpenAICompatibleIntegration } from "../../ai/openAiCompatible";

/** Test lists the models (the cheapest real call); describe and inspect return them. */
const ops = (provider: typeof BaseAiIntegration, name: string) => {
	const models = async (config: any, ctx: IntegrationOpContext): Promise<AiInspectResult> => ({
		models: await provider.ListModels(provider.ExtractConnectionInfo(config, ctx.appConfig)),
	});
	return {
		/** a provider's refusal throws and is reported by the caller */
		async test(config: any, ctx: IntegrationOpContext) {
			if (!(await provider.TestConnection(config, ctx.appConfig))) {
				return { success: false, error: `Failed to connect to ${name}` };
			}
			return { success: true, error: "" };
		},
		describe: models,
		inspect: (config: any, _request: unknown, ctx: IntegrationOpContext) => models(config, ctx),
	};
};

export const AI_OPS = {
	"ai/OpenAI": ops(OpenAIIntegration, "OpenAI"),
	"ai/Anthropic": ops(AnthropicIntegration, "Anthropic"),
	"ai/Gemini": ops(GeminiIntegration, "Gemini"),
	"ai/Mistral": ops(MistralIntegration, "Mistral"),
	"ai/OpenAI Compatible": ops(OpenAICompatibleIntegration, "OpenAI Compatible"),
};
