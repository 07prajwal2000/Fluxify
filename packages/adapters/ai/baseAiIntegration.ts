import { createAgent, DynamicTool } from "langchain";
import { ChatOpenAI } from "@langchain/openai";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatMistralAI } from "@langchain/mistralai";

export class BaseAiIntegration {
  createAgent(tools?: DynamicTool[]): ReturnType<typeof createAgent> {
    throw new Error("Method not implemented.");
  }
  createModel():
    | ChatOpenAI
    | ChatGoogleGenerativeAI
    | ChatAnthropic
    | ChatMistralAI {
    throw new Error("Method not implemented.");
  }
}
