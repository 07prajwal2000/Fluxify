import { ChatOpenAI } from "@langchain/openai";
import { createAgent, DynamicTool } from "langchain";
type OpenAICompatibleVariantConfig = {
  apiKey: string;
  model: string;
  baseUrl: string;
};

export class OpenAICompatibleIntegration {
  constructor(private readonly config: OpenAICompatibleVariantConfig) {}

  createAgent(tools?: DynamicTool[]) {
    const model = new ChatOpenAI({
      apiKey: this.config.apiKey,
      model: this.config.model,
      configuration: {
        baseURL: this.config.baseUrl,
      },
    });
    return createAgent({
      model,
      tools,
    });
  }

  static ExtractConnectionInfo(
    config: OpenAICompatibleVariantConfig,
    appConfigs: Map<string, string>,
  ) {
    if (config.apiKey.startsWith("cfg:")) {
      const apiKey = appConfigs.get(config.apiKey.slice(4));
      if (!apiKey) {
        throw new Error("API key not found");
      }
      config.apiKey = apiKey;
    }
    if (config.baseUrl.startsWith("cfg:")) {
      const baseUrl = appConfigs.get(config.baseUrl.slice(4));
      if (!baseUrl) {
        throw new Error("Base URL not found");
      }
      config.baseUrl = baseUrl;
    }
    return config;
  }

  static async TestConnection(
    config: OpenAICompatibleVariantConfig,
    appConfigs: Map<string, string>,
  ) {
    const extractedConfig = this.ExtractConnectionInfo(config, appConfigs);
    const llm = new ChatOpenAI({
      apiKey: extractedConfig.apiKey,
      model: extractedConfig.model,
      configuration: {
        baseURL: extractedConfig.baseUrl,
      },
    });
    const result = await llm.invoke("Say OK");
    return result.content.length > 0;
  }
}
