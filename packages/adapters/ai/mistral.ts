import { ChatMistralAI } from "@langchain/mistralai";
import { createAgent, DynamicTool } from "langchain";
import { BaseAiIntegration } from "./baseAiIntegration";

type MistralVariantConfig = {
  apiKey: string;
  model: string;
};

export class MistralIntegration extends BaseAiIntegration {
  constructor(private readonly config: MistralVariantConfig) {
    super();
  }

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

  override createModel() {
    return new ChatMistralAI({
      apiKey: this.config.apiKey,
      model: this.config.model,
    });
  }

  override createAgent(tools?: DynamicTool[]) {
    const model = this.createModel();
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
    const model = new MistralIntegration(extractedConfig).createModel();
    const result = await model.invoke("Say OK", {
      timeout: 5_000,
    });
    return result.content.length > 0;
  }
}
