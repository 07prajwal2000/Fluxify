// An `integration(...)` definition as the registry's `IntegrationVariantDef`:
// the one adapter the worker (I6), the test harness and the conformance suite
// all register or run, so the `getConfig` rule and the client lifecycle are
// written once.
import { prepareParams } from "../block.js";
import type { Logger } from "../context.js";
import {
	type AnyIntegration,
	type ConnectContext,
	integrationGroup,
	paramsConfigSchema,
	secretKey,
	secretRef,
} from "../integration.js";
import type {
	DatabasePool,
	IntegrationOpContext,
	IntegrationTestResult,
	IntegrationVariantDef,
} from "../integrations/variants.js";
import { fingerprint } from "./ctx.js";

/** where a resolved config carries its own secrets' values, next to the fields */
export const SECRET_VALUES = "__secretValues";

type Resolved = Record<string, unknown> & { [SECRET_VALUES]?: Record<string, unknown> };
type Opened = { client: unknown; done(): Promise<void> };

const consoleLogger: Logger = {
	logInfo: (v) => console.info(v),
	logWarn: (v) => console.warn(v),
	logError: (v) => console.error(v),
};

/**
 * `getConfig` for one integration's hooks: the keys its own secret fields name,
 * and nothing else. Errors name the key, never a value.
 */
export function ownGetConfig(name: string, values: Record<string, unknown>) {
	return (key: string): string => {
		if (!Object.hasOwn(values, key))
			throw new Error(
				`integration ${name}: getConfig('${key}') is not allowed; an integration reads only the app config keys its own secret fields name`,
			);
		const value = values[key];
		if (value === undefined || value === null)
			throw new Error(
				`integration ${name}: app config key '${key}' has no value in this environment`,
			);
		return String(value);
	};
}

/** A config as `connect` takes it (a secret is its key) -> as stored (a secret is `cfg:<KEY>`). */
export function toStoredConfig(def: AnyIntegration, config: Record<string, unknown>) {
	const stored = { ...config };
	for (const [name, p] of Object.entries(def.config))
		if (p.type === "secret" && typeof stored[name] === "string")
			stored[name] = secretRef(stored[name] as string);
	return stored;
}

/**
 * The stored config -> what the worker caches: each secret back to its key,
 * with the values of those keys alone carried in `SECRET_VALUES` for `getConfig`.
 */
function resolveWith(def: AnyIntegration, stored: any, appConfig: Record<string, unknown> = {}) {
	const out: Resolved = {};
	const values: Record<string, unknown> = {};
	for (const [name, p] of Object.entries(def.config)) {
		const value = stored?.[name];
		if (p.type === "hint" || value === undefined) continue;
		if (p.type === "secret" && typeof value === "string") {
			const key = secretKey(value);
			out[name] = key;
			values[key] = appConfig[key];
		} else out[name] = value;
	}
	out[SECRET_VALUES] = values;
	return out;
}

/** the config `connect` gets: the declared params, defaulted and checked; never the secrets' values */
const configOf = (def: AnyIntegration, resolved: Resolved) => {
	const { [SECRET_VALUES]: _, ...fields } = resolved;
	const declared = Object.fromEntries(
		Object.entries(fields).filter(([k]) => Object.hasOwn(def.config, k)),
	);
	return prepareParams(def.config as never, declared) as any;
};

/**
 * A client that is opening, for the groups whose factories want one at once
 * (database, kv): each method waits for it. `then` is left out, so awaiting
 * the proxy does not wait for it.
 *
 * ponytail: every method looks present, so an optional contract method (a
 * database's `introspect`) reads as implemented; give the def a real adapter
 * class if a caller starts feature-testing them.
 */
function lazyClient(opening: Promise<Opened>, own: Record<string, unknown> = {}) {
	const client = opening.then((o) => o.client as any);
	client.catch(() => {}); // the method that awaits it reports the failure
	return new Proxy(own, {
		get(target, prop) {
			if (Object.hasOwn(target, prop)) return target[prop as string];
			if (prop === "then" || typeof prop === "symbol") return undefined;
			return async (...args: unknown[]) => {
				const c = await client;
				if (typeof c?.[prop] !== "function")
					throw new Error(`the client has no method '${String(prop)}'`);
				return c[prop](...args);
			};
		},
	});
}

/**
 * Registry definition for an `integration(...)`. Pure apart from what the
 * author's hooks do; I6 registers the result on workers. `logger` is what
 * `connect` logs to (default: the console).
 */
export function toVariantDef(
	def: AnyIntegration,
	{ logger = consoleLogger }: { logger?: Logger } = {},
): IntegrationVariantDef {
	/** how to close each client `create` handed out; deleted on the first close, so a client closes once */
	const closers = new WeakMap<object, () => Promise<void>>();

	const open = async (resolved: Resolved): Promise<Opened> => {
		const controller = new AbortController();
		const ctx: ConnectContext = {
			getConfig: ownGetConfig(def.name, resolved[SECRET_VALUES] ?? {}),
			logger,
			signal: controller.signal,
		};
		let closed = false;
		try {
			const client = await def.connect(configOf(def, resolved), ctx);
			return {
				client,
				async done() {
					if (closed) return;
					closed = true;
					controller.abort();
					await def.close?.(client);
				},
			};
		} catch (error) {
			controller.abort();
			throw error;
		}
	};
	const closeClient = async (client: unknown) => {
		const close = typeof client === "object" && client ? closers.get(client) : undefined;
		if (!close) return;
		closers.delete(client as object);
		await close();
	};
	/** a client that stays open until a pool closes it */
	const keep = (opening: Promise<Opened>) => async () =>
		(await opening.catch(() => undefined))?.done();

	/** a Test connection, describe or inspect: a fresh client, closed when the hook is done */
	const withClient = async <T>(
		stored: unknown,
		opCtx: IntegrationOpContext,
		hook: (client: any, config: any) => T | Promise<T>,
	) => {
		const resolved = resolveWith(def, stored, Object.fromEntries(opCtx.appConfig));
		const opened = await open(resolved);
		try {
			return await hook(opened.client, configOf(def, resolved));
		} finally {
			await opened.done();
		}
	};

	const group = integrationGroup(def);
	const hooks: Partial<IntegrationVariantDef> = {
		resolve: (stored, appConfig) => resolveWith(def, stored, appConfig),
		poolKey: (resolved: Resolved) =>
			def.poolKey
				? def.poolKey(configOf(def, resolved))
				: fingerprint({ config: configOf(def, resolved), secrets: resolved[SECRET_VALUES] }),
		close: closeClient,
		...(def.test && {
			test: async (
				stored: unknown,
				opCtx: IntegrationOpContext,
			): Promise<IntegrationTestResult> => {
				try {
					return (await withClient(stored, opCtx, def.test!)) ?? { success: true };
				} catch (error) {
					return { success: false, error: (error as Error)?.message ?? String(error) };
				}
			},
		}),
		...(def.describe && {
			describe: (stored: unknown, opCtx: IntegrationOpContext) =>
				withClient(stored, opCtx, def.describe!) as Promise<any>,
		}),
		...(def.inspect && {
			inspect: (stored: unknown, request: unknown, opCtx: IntegrationOpContext) =>
				withClient(stored, opCtx, (client, config) =>
					def.inspect!(client, request, config),
				) as Promise<any>,
			inspectRequest: def.inspectRequest,
		}),
	};

	if (group === "database") {
		const connect = (resolved: Resolved): DatabasePool => {
			const opening = open(resolved);
			opening.catch(() => {});
			return { db: opening, close: keep(opening) };
		};
		hooks.create = ((_: unknown, { pool }: { pool: DatabasePool }) =>
			lazyClient(pool.db as Promise<Opened>)) as never;
		Object.assign(hooks, { connect });
	} else if (group === "kv") {
		hooks.create = ((resolved: Resolved) => {
			const opening = open(resolved);
			const proxy: object = lazyClient(opening, { disconnect: () => closeClient(proxy) });
			closers.set(proxy, keep(opening));
			return proxy;
		}) as never;
	} else {
		hooks.create = (async (resolved: Resolved) => {
			const opened = await open(resolved);
			if (typeof opened.client === "object" && opened.client)
				closers.set(opened.client, opened.done);
			return opened.client;
		}) as never;
	}

	return {
		group,
		variant: def.variant,
		label: def.label,
		icon: def.icon,
		configSchema: paramsConfigSchema(def.config),
		extras: def.extras,
		...hooks,
	} as IntegrationVariantDef;
}

/**
 * Opens a client of a registered variant from a resolved config, the way its
 * group's factory would, with the call that closes it.
 */
export async function openVariant(variant: IntegrationVariantDef, resolved: unknown) {
	if (variant.group === "database") {
		const pool = (variant as IntegrationVariantDef<"database">).connect(resolved as never);
		const client = (variant as IntegrationVariantDef<"database">).create(resolved as never, {
			pool,
		});
		return { client, close: () => pool.close() };
	}
	const client = await variant.create!(resolved as never, {} as never);
	return { client, close: async () => void (await variant.close?.(client as never)) };
}
