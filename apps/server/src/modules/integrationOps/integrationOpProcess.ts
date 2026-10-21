import { IntegrationRegistry, runIntegrationHook } from "@fluxify/adapters/integrations";
import "../../lib/bigintJson";
import { executionRuntimeEnvironment } from "../requestRouter/executionEnvironment";
import { importIntegration } from "../requestRouter/pluginIntegrations";
import type { IsolatedOpReply, IsolatedOpRequest } from "./isolated";

/**
 * Ephemeral child that runs one plugin integration op (I6) and exits: Test
 * connection, describe or inspect, through the same `runIntegrationHook` the
 * admin uses for built-ins. It imports the one variant the op names and holds
 * no system credential: the supervisor sends the stored config and the values
 * of the app config keys it references, nothing else.
 */
process.env = executionRuntimeEnvironment();
process.argv = [];
process.execArgv = [];

const send = (message: IsolatedOpReply) => process.send?.(message);

process.on("message", async (message: IsolatedOpRequest) => {
	if (message?.type !== "op") return;
	try {
		const registry = new IntegrationRegistry();
		registry.register(await importIntegration(message.ref), message.ref.projectId);
		const result = await runIntegrationHook(
			registry,
			message.op,
			{ ...message.call, projectId: message.ref.projectId },
			() => new Map(message.appConfig),
			message.timeoutMs,
		);
		send({ type: "result", ok: true, result });
	} catch (error) {
		send({
			type: "result",
			ok: false,
			error: error instanceof Error ? error.message : String(error),
		});
	}
	// let the ipc write flush; the parent kills it regardless
	setTimeout(() => process.exit(0), 0);
});

send({ type: "ready" });
