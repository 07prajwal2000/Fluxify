import { startMathMcp } from "./server";

// bun testing/mcp-math/src/cli.ts --port 3999 --header x-api-key=secret
const args = process.argv.slice(2);
const flag = (name: string) => {
	const i = args.indexOf(name);
	return i >= 0 ? args[i + 1] : undefined;
};
const headers: Record<string, string> = {};
for (let i = 0; i < args.length; i++) {
	if (args[i] !== "--header") continue;
	const [key, ...value] = (args[++i] ?? "").split("=");
	headers[key] = value.join("=");
}

const server = await startMathMcp({ port: Number(flag("--port") ?? 0), headers });
console.log(`math MCP listening at ${server.url}`);
