import { instantiateCompiled, registerCompiledCustomBlock } from "@fluxify/blocks";
import { hydrateAppConfig } from "../../loaders/appconfigLoader";
import { hydrateIntegrations } from "../../loaders/integrationsLoader";
import { hydrateProjectSettings } from "../../loaders/projectSettingsLoader";
import { executionRuntimeEnvironment } from "../requestRouter/executionEnvironment";
import { setBlocksExecutor } from "../requestRouter/executor";
import { createHttpContext } from "../requestRouter/httpContext";
import { executeRouteInternal } from "../requestRouter/service";
import type {
	TestBootstrap,
	TestBootstrapMessage,
	TestChildMessage,
	TestResult,
} from "./types";

/**
 * Ephemeral child that runs exactly one test suite and exits.
 *
 * Never reused. A second suite in the same process would inherit module state,
 * open database clients and timers from the first — the precise thing that makes
 * a test pass for the wrong reason.
 *
 * It holds no system credentials: no master encryption key, no NATS, no admin
 * database url. The route's own integration connection details do arrive in the
 * bootstrap, because the route cannot run without them.
 */
process.env = executionRuntimeEnvironment();
process.argv = [];
process.execArgv = [];

process.on("message", (message: TestBootstrapMessage) => {
	if (message?.type !== "bootstrap") return;
	void runSuite(message.bootstrap);
});

async function runSuite(boot: TestBootstrap) {
	const startedAt = Date.now();
	try {
		// the caches are the runtime's only config source — executeRouteInternal
		// queries nothing, and the suite's overrides are already baked in here
		hydrateAppConfig(boot.projectId, boot.config.appConfig);
		hydrateIntegrations(boot.projectId, {
			db: boot.config.dbIntegrations,
			kv: boot.config.kvIntegrations,
			observability: boot.config.observabilityIntegrations,
			ai: boot.config.aiIntegrations,
		});
		hydrateProjectSettings(boot.projectId, boot.config.projectSettings);

		// custom blocks first: a route that invokes one needs it in the library
		for (const block of boot.customBlocks) {
			registerCompiledCustomBlock(block.name, block.source);
		}

		const run = instantiateCompiled(boot.source);
		setBlocksExecutor((_target, context) => run(context, context.requestBody));

		// a real Hono-shaped context, so header and cookie writes made by the route
		// are captured instead of dropped — header assertions read them back
		const ctx = createHttpContext(
			new Request(`http://test.local${boot.request.path}`, {
				method: boot.request.method,
				headers: boot.request.headers,
			}),
		);

		const response = await executeRouteInternal(
			{
				id: boot.route.id,
				projectId: boot.projectId,
				projectName: boot.route.projectName,
				bodySchema: boot.route.bodySchema,
				querySchema: boot.route.querySchema,
				paramsSchema: boot.route.paramsSchema,
				// the engine's in-band stall budget, from the same number the
				// watchdog uses, so neither can silently outlive the other
				timeoutSeconds: boot.timeoutMs / 1000,
			},
			boot.request,
			ctx as any,
		);

		report({
			ok: true,
			status: response.status,
			data: response.data,
			headers: Object.fromEntries(ctx.responseHeaders),
			durationMs: Date.now() - startedAt,
		});
	} catch (error) {
		report({
			ok: false,
			error: error instanceof Error ? error.message : String(error),
			durationMs: Date.now() - startedAt,
		});
	}
}

function report(result: TestResult) {
	process.send?.({ type: "result", result } satisfies TestChildMessage);
	// let the ipc write flush before tearing the process down; the parent kills
	// the child regardless, so this is only about exiting cleanly
	setTimeout(() => process.exit(0), 0);
}

process.send?.({ type: "ready" } satisfies TestChildMessage);
