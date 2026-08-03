import { tool } from "@langchain/core/tools";
import type { z } from "zod";
import { fenceUntrusted } from "../internal/untrusted";

/**
 * Drop-in replacement for langchain's `tool()` that fences whatever the tool
 * returns as untrusted content.
 *
 * Every harness tool reads from the project database, the vector store, or a
 * previous run's output — all of it user- or collaborator-controlled. Doing
 * the wrapping here rather than in each tool body means a tool added later is
 * fenced by default instead of by remembering.
 */
export function fencedTool<T extends z.ZodObject<any>>(
	fn: (input: z.infer<T>, config?: any) => Promise<string> | string,
	config: { name: string; description: string; schema: T },
) {
	return tool(
		async (input: z.infer<T>, runConfig: any) =>
			fenceUntrusted(config.name, String(await fn(input, runConfig))),
		config,
	);
}
