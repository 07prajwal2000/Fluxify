import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { executionRuntimeEnvironment } from "./executionEnvironment";

const fixture = fileURLToPath(
	new URL("./executionEnvironmentChild.fixture.ts", import.meta.url),
);

test.if(process.platform === "win32")(
	"allows a sanitized execution process to make Bun network requests on Windows",
	async () => {
		const server = Bun.serve({
			port: 0,
			fetch: () => new Response("ok"),
		});
		try {
			const child = Bun.spawn([process.execPath, fixture, `http://127.0.0.1:${server.port}`], {
				env: executionRuntimeEnvironment(),
				stdout: "ignore",
				stderr: "inherit",
			});
			expect(await child.exited).toBe(0);
		} finally {
			server.stop(true);
		}
	},
);
