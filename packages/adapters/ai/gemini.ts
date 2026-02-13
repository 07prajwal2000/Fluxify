import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createAgent, DynamicTool } from "langchain";

type GeminiVariantConfig = {
  apiKey: string;
  model: string;
};

export class GeminiIntegration {
  constructor(private readonly config: GeminiVariantConfig) {}

  createAgent(tools?: DynamicTool[]) {
    const model = new ChatGoogleGenerativeAI({
      apiKey: this.config.apiKey,
      model: this.config.model,
    });
    return createAgent({
      model,
      tools,
    });
  }
  static ExtractConnectionInfo(
    config: GeminiVariantConfig,
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

  static async TestConnection(
    config: GeminiVariantConfig,
    appConfigs: Map<string, string>,
  ) {
    const extractedConfig = this.ExtractConnectionInfo(config, appConfigs);
    const llm = new ChatGoogleGenerativeAI({
      apiKey: extractedConfig.apiKey,
      model: extractedConfig.model,
    });
    const result = await llm.invoke("Say OK");
    return result.content.length > 0;
  }
}
