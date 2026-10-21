import type { IntegrationClient, Logger } from "../context.js";
import type { AnyIntegration } from "../integration.js";
import type { IntegrationOpContext, IntegrationVariantDef } from "../integrations/variants.js";
import { openVariant, toStoredConfig, toVariantDef } from "../runtime/integration.js";
import { type LogEntry, recordingLogger } from "./fakes.js";

export type RunIntegrationOptions = {
	/** the config as `connect` gets it: a secret field holds its app config key (`cfg:KEY` works too) */
	config: Record<string, unknown>;
	/** the environment's app config, by key; `getConfig` reads only the keys the secret fields name */
	appConfig?: Record<string, string | number | boolean>;
	logger?: Logger;
};

const issues = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }) =>
	error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join("; ");

/**
 * Turns harness options into what a worker holds: the registry definition, the
 * stored config (checked as the admin checks it on save) and its resolved form.
 */
export function prepareIntegration(def: AnyIntegration, o: RunIntegrationOptions) {
	const logs: LogEntry[] = [];
	const variant = toVariantDef(def, { logger: o.logger ?? recordingLogger(logs) });
	const stored = toStoredConfig(def, o.config);
	const valid = variant.configSchema.safeParse(stored);
	if (!valid.success) throw new Error(`Invalid configuration: ${issues(valid.error)}`);
	const appConfig = o.appConfig ?? {};
	return { variant, stored, resolved: variant.resolve!(stored, appConfig), appConfig, logs };
}

/** the op hook, run the way the worker runs it: a missing hook and a bad inspect request fail first */
async function runOp(
	variant: IntegrationVariantDef,
	op: "test" | "describe" | "inspect",
	stored: unknown,
	opCtx: IntegrationOpContext,
	request?: unknown,
) {
	const hook = variant[op] as ((...args: unknown[]) => Promise<unknown>) | undefined;
	if (!hook)
		throw new Error(
			`${{ test: "Test connection", describe: "Metadata", inspect: "Inspect" }[op]} is not available for ${variant.group}/${variant.variant} integrations`,
		);
	if (op !== "inspect") return hook(stored, opCtx);
	const parsed = variant.inspectRequest?.safeParse(request ?? {});
	if (parsed && !parsed.success) throw new Error(`Invalid request: ${issues(parsed.error)}`);
	return hook(stored, parsed ? parsed.data : request, opCtx);
}

/**
 * Runs an integration with no Fluxify runtime, by the rules a worker runs it:
 * `getConfig` reads only the keys its own secret fields name, Test connection,
 * describe and inspect each open a fresh client and close it, and `client()`
 * opens the one a block would get (closed by `close()`).
 */
export function runIntegration<I extends AnyIntegration>(def: I, options: RunIntegrationOptions) {
	const { variant, stored, resolved, appConfig, logs } = prepareIntegration(def, options);
	const opCtx: IntegrationOpContext = {
		appConfig: new Map(Object.entries(appConfig).map(([k, v]) => [k, String(v)])),
		options: {},
	};
	let opened: ReturnType<typeof openVariant> | undefined;
	return {
		logs,
		client: async () => {
			opened ??= openVariant(variant, resolved);
			return (await opened).client as IntegrationClient<I>;
		},
		close: async () => {
			const o = opened;
			opened = undefined;
			await (await o)?.close();
		},
		test: () =>
			runOp(variant, "test", stored, opCtx) as ReturnType<
				NonNullable<IntegrationVariantDef["test"]>
			>,
		describe: () => runOp(variant, "describe", stored, opCtx),
		inspect: (request?: unknown) => runOp(variant, "inspect", stored, opCtx, request),
	};
}
