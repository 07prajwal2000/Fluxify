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
import type { IntegrationEntry } from "../manifest.js";
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

/** the contract methods the factories call, which a lazy client hands on */
const KV_METHODS = ["get", "set", "setex", "delete"] as const;
const DATABASE_METHODS = [
	"getAll",
	"getPage",
	"getSingle",
	"count",
	"insert",
	"insertBulk",
	"update",
	"raw",
	"delete",
	"setMode",
	"startTransaction",
	"commitTransaction",
	"rollbackTransaction",
] as const;

/**
 * A client that is still opening, for the factories that want one at once
 * (database, kv): exactly the group's contract methods, each waiting for it.
 * Nothing else is on it, so an optional method (a database's `introspect`)
 * reads as missing and awaiting the client does not wait.
 */
function lazyClient(
	client: Promise<any>,
	methods: readonly string[],
	own: Record<string, unknown> = {},
) {
	client.catch(() => {}); // the method that awaits it reports the failure
	const out: Record<string, unknown> = { ...own };
	for (const method of methods)
		out[method] = async (...args: unknown[]) => {
			const c = await client;
			if (typeof c?.[method] !== "function")
				throw new Error(`the client has no method '${method}'`);
			return c[method](...args);
		};
	return out;
}

/**
 * Registry definition for an `integration(...)`. Pure apart from what the
 * author's hooks do; I6 registers the result on workers. `logger` is what
 * `connect` logs to (default: the console).
 */
export function toVariantDef(
	def: AnyIntegration,
	{ logger = consoleLogger, plugin }: { logger?: Logger; plugin?: string } = {},
): IntegrationVariantDef {
	/** how to close each client `create` handed out; deleted on the first close, so a client closes once */
	const closers = new WeakMap<object, () => Promise<void>>();
	const group = integrationGroup(def);
	/** a database's per-request adapter on its pooled client */
	const adapterOf = (pool: unknown, config: unknown) =>
		(def as AnyIntegration & { adapter(pool: unknown, config: unknown): unknown }).adapter(
			pool,
			config,
		);

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
			const config = configOf(def, resolved);
			// a database's hooks get what a request gets: an adapter on the pool
			const client = group === "database" ? adapterOf(opened.client, config) : opened.client;
			return await hook(client, config);
		} finally {
			await opened.done();
		}
	};

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
		// the built-in split: `connect` is the pooled client the connection manager
		// keeps, `create` one request's adapter on it, which holds that request's transaction
		const connect = (resolved: Resolved): DatabasePool => {
			const opening = open(resolved);
			opening.catch(() => {});
			return { db: opening, close: keep(opening) };
		};
		hooks.create = ((resolved: Resolved, { pool }: { pool: DatabasePool }) =>
			lazyClient(
				(pool.db as Promise<Opened>).then((o) => adapterOf(o.client, configOf(def, resolved))),
				DATABASE_METHODS,
			)) as never;
		Object.assign(hooks, { connect });
	} else if (group === "kv") {
		hooks.create = ((resolved: Resolved) => {
			const opening = open(resolved);
			const client: object = lazyClient(
				opening.then((o) => o.client),
				KV_METHODS,
				{ disconnect: () => closeClient(client) },
			);
			closers.set(client, keep(opening));
			return client;
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
		params: def.config,
		tabs: def.tabs,
		hasTest: typeof def.test === "function",
		hasDescribe: typeof def.describe === "function",
		hasInspect: typeof def.inspect === "function",
		description: def.description,
		docs: def.docs,
		...(plugin && { plugin }),
		...hooks,
	} as IntegrationVariantDef;
}

/**
 * A manifest's integration as the admin registers it (I6): what it is called,
 * the config it validates, and how a stored config resolves for the workers —
 * all from the approved manifest. No plugin code is imported (decision 8), so
 * it has no `create` and no op hooks; those exist only on workers.
 */
export function manifestVariantMeta(
	entry: IntegrationEntry,
	plugin: string,
): IntegrationVariantDef {
	const def = { name: entry.name, config: entry.configSchema } as AnyIntegration;
	return {
		group: entry.group,
		variant: entry.variant,
		label: entry.label,
		icon: entry.icon,
		extras: entry.extras,
		plugin,
		params: entry.configSchema,
		tabs: entry.tabs,
		hasTest: entry.hasTest,
		hasDescribe: entry.hasDescribe,
		hasInspect: entry.hasInspect,
		description: entry.description,
		docs: entry.docs,
		configSchema: paramsConfigSchema(entry.configSchema),
		resolve: (stored: unknown, appConfig: Record<string, unknown> | undefined) =>
			resolveWith(def, stored, appConfig),
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
