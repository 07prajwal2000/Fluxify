import type { IntegrationOpContext } from "@fluxify/sdk/integrations";
import type { IntegrationRegistry } from "../registry";
import { appConfigKeys } from "../resolve";

export const INTEGRATION_OPS = ["test", "describe", "inspect"] as const;
export type IntegrationOp = (typeof INTEGRATION_OPS)[number];

/** One op on one integration config, wherever it runs. */
export type IntegrationOpCall = {
	group: string;
	variant: string;
	/** the stored config, `cfg:` references unresolved */
	config: unknown;
	/** inspect only: the variant-defined request */
	request?: unknown;
	options?: Record<string, unknown>;
};

/** A failure whose message is meant for the caller. */
export class IntegrationOpError extends Error {
	override name = "IntegrationOpError";
}

const LABEL: Record<IntegrationOp, string> = {
	test: "Test connection",
	describe: "Metadata",
	inspect: "Inspect",
};

const issues = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }) =>
	error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");

/**
 * Validates the call against its variant, reads the app config it references
 * (`loadAppConfig`, whose source depends on where this runs) and runs the hook
 * within `timeoutMs`. Everything it throws names what went wrong.
 */
export async function runIntegrationHook(
	registry: IntegrationRegistry,
	op: IntegrationOp,
	call: IntegrationOpCall,
	/** the values of these app config keys, in the environment the op runs for */
	loadAppConfig: (keys: string[]) => Promise<Map<string, string>> | Map<string, string>,
	timeoutMs: number,
): Promise<unknown> {
	const def = registry.require(call.group, call.variant);
	const hook = def[op] as ((...args: unknown[]) => Promise<unknown>) | undefined;
	if (!hook) {
		throw new IntegrationOpError(
			`${LABEL[op]} is not available for ${def.group}/${def.variant} integrations`,
		);
	}
	// inspect reads saved integrations only, each validated when it was saved
	const parsed = op === "inspect" ? null : def.configSchema.safeParse(call.config);
	if (parsed && !parsed.success) {
		throw new IntegrationOpError(`Invalid configuration: ${issues(parsed.error)}`);
	}
	const args: unknown[] = [call.config];
	if (op === "inspect") {
		const request = def.inspectRequest ? def.inspectRequest.safeParse(call.request ?? {}) : null;
		if (request && !request.success) {
			throw new IntegrationOpError(`Invalid request: ${issues(request.error)}`);
		}
		args.push(request ? request.data : call.request);
	}
	const ctx: IntegrationOpContext = {
		appConfig: await loadAppConfig(appConfigKeys(call.config)),
		options: call.options ?? {},
	};
	return withTimeout(op, hook.call(def, ...args, ctx), timeoutMs);
}

async function withTimeout<T>(op: IntegrationOp, work: Promise<T>, timeoutMs: number) {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const seconds = timeoutMs / 1000;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() =>
				reject(
					new IntegrationOpError(
						op === "test"
							? `Connection timed out after ${seconds} seconds`
							: `timed out after ${seconds} seconds`,
					),
				),
			timeoutMs,
		);
	});
	try {
		return await Promise.race([work, timeout]);
	} finally {
		clearTimeout(timer);
	}
}
