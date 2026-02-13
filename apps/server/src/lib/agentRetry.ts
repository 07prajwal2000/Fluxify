import { z } from "zod";
import yaml from "yaml";

type Message = ["system" | "user" | "ai", string];

interface RetryConfig {
  maxRetries: number;
}

/**
 * A higher-order function that wraps an LLM invocation with retry logic.
 * It automatically formats Zod errors and injects them into the prompt for the next attempt.
 */
export async function withRetry<T>(
  invokeLogic: (history: Message[]) => Promise<string>,
  schema: z.ZodSchema<T>,
  initialMessages: Message[],
  config: RetryConfig = { maxRetries: 3 },
): Promise<T> {
  let attempts = config.maxRetries;
  let conversationHistory = [...initialMessages];

  while (attempts > 0) {
    try {
      // 1. Execute the agent logic
      const rawResponse = await invokeLogic(conversationHistory);

      // 2. Parse JSON (handle potential markdown code blocks)
      const cleanedJson = rawResponse
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();
      const parsedJson = JSON.parse(cleanedJson);

      // 3. Validate Schema
      return schema.parse(parsedJson);
    } catch (error) {
      attempts--;

      // 4. Format Error Message
      let errorMessage = "Unknown error occurred.";
      if (error instanceof z.ZodError) {
        // Use your preferred YAML error formatting
        errorMessage = `Validation Error:\n${yaml.stringify(z.treeifyError(error))}`;
      } else if (error instanceof SyntaxError) {
        errorMessage = `JSON Parsing Error: ${error.message}`;
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      console.error(
        `Retrying... Attempts left: ${attempts}. Error: ${errorMessage}`,
      );

      // 5. Inject error into history for the next loop
      // We tell the AI exactly what went wrong so it can fix it.
      conversationHistory.push([
        "system",
        `Your previous response was invalid. Please correct it and output ONLY valid JSON.\nError Details: ${errorMessage}`,
      ]);
    }
  }

  throw new Error(
    `Failed to get a valid response after ${config.maxRetries} attempts.`,
  );
}
