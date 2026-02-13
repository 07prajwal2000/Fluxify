import { ChatOpenAI } from "@langchain/openai";
import { createAgent, DynamicTool } from "langchain";
type OpenAIVariantConfig = {
  apiKey: string;
  model: string;
};

export class OpenAIIntegration {
  constructor(private readonly config: OpenAIVariantConfig) {}

  createAgent(tools?: DynamicTool[]) {
    const model = new ChatOpenAI({
      apiKey: this.config.apiKey,
      model: this.config.model,
    });
    return createAgent({
      model,
      tools,
    });
  }

  static ExtractConnectionInfo(
    config: OpenAIVariantConfig,
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
    config: OpenAIVariantConfig,
    appConfigs: Map<string, string>,
  ) {
    const extractedConfig = this.ExtractConnectionInfo(config, appConfigs);
    const llm = new ChatOpenAI({
      apiKey: extractedConfig.apiKey,
      model: extractedConfig.model,
    });
    const result = await llm.invoke("Say OK");
    return result.content.length > 0;
  }
}
