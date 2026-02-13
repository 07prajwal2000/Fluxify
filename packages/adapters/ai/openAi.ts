import { ChatOpenAI } from "@langchain/openai";
import { createAgent, DynamicTool } from "langchain";
import { BaseAiIntegration } from "./baseAiIntegration";

type OpenAIVariantConfig = {
  apiKey: string;
  model: string;
};

export class OpenAIIntegration extends BaseAiIntegration {
  constructor(private readonly config: OpenAIVariantConfig) {
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
    return new ChatOpenAI({
      apiKey: this.config.apiKey,
      model: this.config.model,
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
    const llm = new OpenAIIntegration(extractedConfig).createModel();
    const result = await llm.invoke("Say OK");
    return result.content.length > 0;
  }
}
