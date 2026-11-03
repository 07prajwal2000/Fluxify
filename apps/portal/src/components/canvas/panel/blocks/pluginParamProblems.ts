import type { Param, Params } from "@fluxify/sdk/blocks";
import { paramProblems } from "@fluxify/sdk/blocks";

/**
 * What the server's save refuses a plugin block, an integration or a trigger
 * for, as a sentence naming its param ("Channel is required"), by param name.
 * The SDK holds the rules; the editor only words them.
 */
export function pluginParamProblems(
	params: Record<string, Param>,
	values: Record<string, unknown>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(paramProblems(params as Params, values)).map(([name, problem]) => [
			name,
			`${(params[name] as { label?: string }).label ?? name} ${problem}`,
		]),
	);
}
