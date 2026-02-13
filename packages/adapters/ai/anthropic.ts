import { ChatAnthropic } from "@langchain/anthropic";
import { createAgent, DynamicTool } from "langchain";
import { BaseAiIntegration } from "./baseAiIntegration";

type AnthropicVariantConfig = {
  apiKey: string;
  model: string;
};

export class AnthropicIntegration extends BaseAiIntegration {
  constructor(private readonly config: AnthropicVariantConfig) {
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
    return new ChatAnthropic({
      apiKey: this.config.apiKey,
      model: this.config.model,
    });
  }

  static ExtractConnectionInfo(
    config: AnthropicVariantConfig,
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
    config: AnthropicVariantConfig,
    appConfigs: Map<string, string>,
  ) {
    const extractedConfig = this.ExtractConnectionInfo(config, appConfigs);
    const model = new AnthropicIntegration(extractedConfig).createModel();
    const result = await model.invoke("Say OK");
    return result.content.length > 0;
  }
}
