import {
  AnthropicIntegration,
  BaseAiIntegration,
  GeminiIntegration,
  MistralIntegration,
  OpenAICompatibleIntegration,
  OpenAIIntegration,
} from "@fluxify/adapters";
import z from "zod";
import { aiVariantSchema } from "../../api/v1/integrations/schemas";

export class AIAdapterFactory {
  static CreateAdapter(
    variant: z.infer<typeof aiVariantSchema>,
    config: any,
  ): BaseAiIntegration {
    switch (variant) {
      case "OpenAI":
        return new OpenAIIntegration(config);
      case "Gemini":
        return new GeminiIntegration(config);
      case "Anthropic":
        return new AnthropicIntegration(config);
      case "Mistral":
        return new MistralIntegration(config);
      case "OpenAI Compatible":
        return new OpenAICompatibleIntegration(config);
      default:
        throw new Error("Invalid variant");
    }
  }
}
