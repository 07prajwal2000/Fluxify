import { ChatMistralAI } from "@langchain/mistralai";
import { createAgent, DynamicTool } from "langchain";

type MistralVariantConfig = {
  apiKey: string;
  model: string;
};

export class MistralIntegration {
  constructor(private readonly config: MistralVariantConfig) {}

  static ExtractConnectionInfo(
    config: MistralVariantConfig,
    appConfigs: Map<string, string>,
  ) {
    if (config.apiKey.startsWith("cfg:")) {
      const apiKey = appConfigs.get(config.apiKey.slice(4));
      if (!apiKey) {
        throw new Error("API key not found");
      }
      config.apiKey = apiKey;
    }
    return config;
  }

  createAgent(tools?: DynamicTool[]) {
    const model = new ChatMistralAI({
      apiKey: this.config.apiKey,
      model: this.config.model,
    });
    return createAgent({
      model,
      tools,
    });
  }

  static async TestConnection(
    config: MistralVariantConfig,
    appConfigs: Map<string, string>,
  ) {
    const extractedConfig = this.ExtractConnectionInfo(config, appConfigs);
    const model = new ChatMistralAI({
      apiKey: extractedConfig.apiKey,
      model: extractedConfig.model,
    });
    const result = await model.invoke("Say OK", {
      timeout: 5_000,
    });
    return result.content.length > 0;
  }
}
