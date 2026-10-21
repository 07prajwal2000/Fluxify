import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { IntegrationOp, IntegrationOpCall } from "@fluxify/adapters/integrations";
import { executionRuntimeEnvironment } from "../requestRouter/executionEnvironment";
import type { PluginIntegrationRef } from "../requestRouter/pluginIntegrations";
import { spawnCommand } from "../testRunner/spawn";

/** What the supervisor hands the op child: no sealed payload, no key, only what the hook reads. */
export type IsolatedOpRequest = {
	type: "op";
	ref: PluginIntegrationRef;
	op: IntegrationOp;
	call: IntegrationOpCall;
	/** the values of the keys the config references, from this environment's project config */
	appConfig: [string, string][];
	timeoutMs: number;
};

export type IsolatedOpReply =
	| { type: "ready" }
	| { type: "result"; ok: true; result: unknown }
	| { type: "result"; ok: false; error: string };

/** past the hook's own timeout, the time the child gets to report before it is killed */
const GRACE_MS = 2_000;

/**
 * The child's entry: a sibling of the bundled supervisor in the image (one flat
 * `dist/`, like `testExecutionProcess.js`), the source file otherwise.
 */
const bundled = new URL("./integrationOpProcess.js", import.meta.url);
export const OP_PROCESS_ENTRY = fileURLToPath(
	existsSync(bundled) ? bundled : new URL("./integrationOpProcess.ts", import.meta.url),
);

/**
 * Runs one plugin variant's Test connection, describe or inspect in a fresh
 * process (I6), the way a test suite runs: it gets the execution environment,
 * never MASTER_ENCRYPTION_KEY or NATS, and is killed once it answers or runs
 * out of time. A fresh one per op, so no plugin state outlives the op.
 */
export function runOpInChild(
	request: Omit<IsolatedOpRequest, "type">,
	entry = OP_PROCESS_ENTRY,
): Promise<unknown> {
	const { promise, resolve, reject } = Promise.withResolvers<unknown>();
	let settled = false;
	const settle = (fn: () => void) => {
		if (settled) return;
		settled = true;
		clearTimeout(watchdog);
		child.kill();
		fn();
	};
	const watchdog = setTimeout(
		() =>
			settle(() =>
				reject(
					new Error(
						request.op === "test"
							? `Connection timed out after ${request.timeoutMs / 1000} seconds`
							: `timed out after ${request.timeoutMs / 1000} seconds`,
					),
				),
			),
		request.timeoutMs + GRACE_MS,
	);
	const child = Bun.spawn(spawnCommand(entry), {
		env: executionRuntimeEnvironment(),
		stdout: "inherit",
		stderr: "inherit",
		ipc(message: IsolatedOpReply) {
			if (message?.type === "ready")
				child.send({ type: "op", ...request } satisfies IsolatedOpRequest);
			else if (message?.type === "result")
				settle(() =>
					message.ok ? resolve(message.result) : reject(new Error(String(message.error))),
				);
		},
		onExit(_child, code, signal) {
			settle(() =>
				reject(
					new Error(
						`the integration process exited before answering (code=${code}, signal=${signal})`,
					),
				),
			);
		},
	});
	return promise;
}
