import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import {
	BaseMessage,
	SystemMessage,
	HumanMessage,
	AIMessage,
} from "@langchain/core/messages";
import { Runnable, RunnableConfig } from "@langchain/core/runnables";
import { StructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { withRetry } from "../../lib/retry";

export interface AgentInvokeOptions {
	zodSchema?: z.ZodType<any>;
	userQuery?: string;
	systemPrompt?: string;
	messages?: BaseMessage[];
	tools?: StructuredTool[];
	config?: RunnableConfig;
}

export abstract class BaseAgentWrapper {
	protected modelName: string;
	protected apiKey?: string;
	protected additionalHeaders?: Record<string, string>;

	constructor(
		modelName: string,
		apiKey?: string,
		additionalHeaders?: Record<string, string>,
	) {
		this.modelName = modelName;
		this.apiKey = apiKey;
		this.additionalHeaders = additionalHeaders;
	}

	// Each subclass implements this to return the initialized LangChain chat model
	protected abstract getModel(): BaseChatModel;

	// Subclasses can override this if they don't natively support withStructuredOutput.
	protected supportsStructuredOutput(): boolean {
		return true;
	}

	public async invokeAgent<T = any>(
		options: AgentInvokeOptions,
	): Promise<T | AIMessage> {
		const {
			zodSchema,
			userQuery,
			systemPrompt,
			messages = [],
			tools,
			config,
		} = options;

		let finalMessages: BaseMessage[] = [...messages];

		if (systemPrompt && !finalMessages.some((m) => m._getType() === "system")) {
			finalMessages.unshift(new SystemMessage(systemPrompt));
		}

		if (userQuery) {
			finalMessages.push(new HumanMessage(userQuery));
		}

		let model = this.getModel();

		if (tools && tools.length > 0) {
			if (model.bindTools) {
				model = model.bindTools(tools) as any;
			}
		}

		if (zodSchema) {
			if (this.supportsStructuredOutput() && model.withStructuredOutput) {
				const structuredModel = model.withStructuredOutput(zodSchema);
				// By using invoke with config, it automatically logs to LangSmith/Langfuse
				return await withRetry(
					() => structuredModel.invoke(finalMessages, config) as Promise<T>,
					{ maxRetries: 3 },
				);
			} else {
				// Fallback implementation for models that don't support withStructuredOutput natively
				return await withRetry(
					() =>
						this.fallbackStructuredOutput(
							model,
							finalMessages,
							zodSchema,
							config,
						) as Promise<T>,
					{ maxRetries: 3 },
				);
			}
		}

		return await withRetry(() => model.invoke(finalMessages, config), {
			maxRetries: 3,
		});
	}

	protected async fallbackStructuredOutput<T>(
		model: BaseChatModel | Runnable<any, any>,
		messages: BaseMessage[],
		schema: z.ZodType<any>,
		config?: RunnableConfig,
	): Promise<T> {
		const jsonSchema = zodToJsonSchema(schema as any);

		const formatInstructions = `
You must respond with ONLY a valid JSON object matching the following JSON schema. 
Do not include any markdown formatting (like \`\`\`json) or <think> tags in your final JSON output.
Your output will be parsed directly by JSON.parse().

Schema:
${JSON.stringify(jsonSchema, null, 2)}
`;

		let modifiedMessages = [...messages];
		const systemMessageIndex = modifiedMessages.findIndex(
			(m) => m.type === "system",
		);

		if (systemMessageIndex >= 0) {
			const existingSystem = modifiedMessages[systemMessageIndex].content;
			modifiedMessages[systemMessageIndex] = new SystemMessage(
				`${existingSystem}\n\n${formatInstructions}`,
			);
		} else {
			modifiedMessages.unshift(new SystemMessage(formatInstructions));
		}

		const response = await model.invoke(modifiedMessages, config);
		let content = response.content as string;

		content = this.cleanJsonOutput(content);

		try {
			const parsed = JSON.parse(content);
			return schema.parse(parsed);
		} catch (error) {
			throw new Error(
				`Failed to parse structured output. Model response: ${content}. Error: ${error}`,
			);
		}
	}

	protected cleanJsonOutput(content: string): string {
		// Remove <think>...</think> blocks from deepseek or reasoning models
		content = content.replace(/<think>[\s\S]*?<\/think>/g, "");

		// Remove markdown code blocks if present
		const codeBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
		if (codeBlockMatch && codeBlockMatch[1]) {
			content = codeBlockMatch[1];
		}

		return content.trim();
	}
}
