import { parseArgs } from "node:util";
import { ADMIN_API_URL } from "../lib/env";
import { runAgent } from "./agent";
import { modelFromEnv } from "./model";
import { agentTools } from "./tools";

/**
 * Terminal agent against a Fluxify admin API, acting as the user behind FLUXIFY_PAT.
 *   bun run agent "<prompt>" --project <id>
 * Env: AGENT_PROVIDER, AGENT_MODEL, AGENT_API_KEY, AGENT_BASE_URL, FLUXIFY_PAT,
 * FLUXIFY_URL (the admin server, http://127.0.0.1:$SERVER_PORT by default).
 */

const MAX_CHARS = 200;
export const short = (v: unknown) => {
	const s = typeof v === "string" ? v : JSON.stringify(v);
	return s && s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS)}…` : s;
};

/** Builds the agent from env and runs one prompt. */
export function startAgent(prompt: string, projectId: string) {
	const pat = process.env.FLUXIFY_PAT;
	if (!pat) throw new Error("FLUXIFY_PAT is required: a personal access token from the portal");
	const base = process.env.FLUXIFY_URL || ADMIN_API_URL;
	const { tools, active } = agentTools(
		(path, init) => fetch(`${base}${path}`, init),
		{ authorization: `Bearer ${pat}` },
		projectId,
	);
	return runAgent({ model: modelFromEnv(process.env), tools, active, projectId, prompt });
}

/** Writes text, tool calls, results and per-step usage as they stream. */
export async function printRun(result: ReturnType<typeof runAgent>, write: (s: string) => void) {
	let step = 0;
	for await (const part of result.stream) {
		switch (part.type) {
			case "text-delta":
				write(part.text);
				break;
			case "tool-call":
				write(`\n> ${part.toolName} ${short(part.input)}\n`);
				break;
			case "tool-result":
				write(`  = ${short(part.output)}\n`);
				break;
			case "tool-error":
				write(`  ! ${short(part.error instanceof Error ? part.error.message : part.error)}\n`);
				break;
			case "finish-step":
				step++;
				write(
					`\n[step ${step}: ${part.usage.inputTokens ?? "?"} in / ${part.usage.outputTokens ?? "?"} out, ${part.finishReason}]\n`,
				);
				break;
			case "error":
				write(
					`\n[error] ${part.error instanceof Error ? part.error.message : short(part.error)}\n`,
				);
				break;
		}
	}
}

if (import.meta.main) {
	const { values, positionals } = parseArgs({
		args: Bun.argv.slice(2),
		options: { project: { type: "string" } },
		allowPositionals: true,
	});
	const prompt = positionals.join(" ");
	if (!prompt || !values.project) {
		console.error('Usage: bun run agent "<prompt>" --project <projectId>');
		process.exit(1);
	}
	const result = startAgent(prompt, values.project);
	await printRun(result, (s) => process.stdout.write(s));
	const total = await result.totalUsage;
	console.log(`\n[total: ${total.inputTokens ?? "?"} in / ${total.outputTokens ?? "?"} out]`);
}
