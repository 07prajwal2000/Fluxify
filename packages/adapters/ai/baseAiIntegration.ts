import type { ChatAnthropic } from "@langchain/anthropic";
import type { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import type { ChatMistralAI } from "@langchain/mistralai";
import type { ChatOpenAI } from "@langchain/openai";
import { type createAgent, type DynamicStructuredTool, Tool } from "langchain";

export class BaseAiIntegration {
	createAgent(
		systemPrompt: string,
		tools: DynamicStructuredTool[],
	): ReturnType<typeof createAgent> {
		throw new Error("Method not implemented.");
	}
	createModel(): ChatOpenAI | ChatGoogleGenerativeAI | ChatAnthropic | ChatMistralAI {
		throw new Error("Method not implemented.");
	}
}
