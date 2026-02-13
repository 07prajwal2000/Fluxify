import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { createAgent, DynamicTool } from "langchain";
import { BaseAiIntegration } from "./baseAiIntegration";

type GeminiVariantConfig = {
  apiKey: string;
  model: string;
};

export class GeminiIntegration extends BaseAiIntegration {
  constructor(private readonly config: GeminiVariantConfig) {
    super();
  }

  override createAgent(tools?: DynamicTool[]) {
    const model = this.createModel();
    return createAgent({
      model,
      tools,
    });
  }

  override createModel() {
    return new ChatGoogleGenerativeAI({
      apiKey: this.config.apiKey,
      model: this.config.model,
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
    const llm = new GeminiIntegration(extractedConfig).createModel();
    const result = await llm.invoke("Say OK");
    return result.content.length > 0;
  }
}
