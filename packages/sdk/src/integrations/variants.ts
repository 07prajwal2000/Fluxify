import type { z } from "zod";
import type { AiAdapter } from "./ai.js";
import type { BaasAdapter } from "./baas.js";
import type { Connection, DatabaseAdapter, IntrospectedTable, SchemaDetails } from "./database.js";
import type { KvAdapter, KvConnectionConfig } from "./kv.js";
import type { McpAdapter } from "./mcp.js";
import type { ObservabilityAdapter } from "./observability.js";
import type { QueueConnector, QueueProducer } from "./queue.js";

/**
 * The groups Fluxify ships. Fixed: a plugin adds variants to them, or brings
 * its own group under its namespace (`acme/<group>`), never a new bare group.
 */
export const BUILT_IN_INTEGRATION_GROUPS = [
	"database",
	"kv",
	"ai",
	"baas",
	"observability",
	"queue",
	"mcp",
] as const;

/**
 * The built-in variants' names and stored aliases, per group: a plugin variant
 * of a built-in group may not take one. `@fluxify/adapters` checks this list
 * against its registry, so it cannot drift.
 */
export const BUILT_IN_VARIANT_NAMES: Record<
	(typeof BUILT_IN_INTEGRATION_GROUPS)[number],
	readonly string[]
> = {
	database: ["PostgreSQL", "MongoDB", "MySQL"],
	kv: ["Redis", "Memcached"],
	ai: ["OpenAI", "Anthropic", "Gemini", "Mistral", "OpenAI Compatible"],
	baas: [],
	observability: ["Open Telemetry", "Open Telemetry Logs", "Loki"],
	queue: ["Kafka", "NATS", "SQS", "RabbitMQ"],
	mcp: ["http"],
};
/** a built-in variant's older names still stored on rows -> its name */
export const BUILT_IN_VARIANT_ALIASES = {
	observability: { "Open Telemetry Logs": "Open Telemetry" },
} as const satisfies { [G in IntegrationGroup]?: Record<string, string> };

/** A variant's own name for an alias of a built-in one; any other name as it is. */
export function canonicalVariant(group: string, variant: string): string {
	const aliases = (BUILT_IN_VARIANT_ALIASES as Record<string, Record<string, string>>)[group];
	return (aliases && Object.hasOwn(aliases, variant) && aliases[variant]) || variant;
}

/** whether `variant` (a name or an alias) is one Fluxify ships for `group` */
export function isBuiltInVariant(group: string, variant: string) {
	return isBuiltInIntegrationGroup(group) && BUILT_IN_VARIANT_NAMES[group].includes(variant);
}

/**
 * Whether an integration param's `variants` takes an integration of `variant`.
 * Names and aliases match each other; no `variants` takes every variant.
 */
export function variantAllowed(
	variants: readonly string[] | undefined,
	group: string,
	variant: string,
) {
	if (!variants) return true;
	const name = canonicalVariant(group, variant);
	return variants.some((v) => canonicalVariant(group, v) === name);
}

/** the built-in database variants' `dbType`s; a plugin database variant needs its own */
export const BUILT_IN_DB_TYPES: readonly string[] = ["pg", "mongo", "mysql"];

/** Built-in integration groups supported by Fluxify. */
export type IntegrationGroup = (typeof BUILT_IN_INTEGRATION_GROUPS)[number];
/** A plugin's own group, `<namespace>/<group>`. */
export type NamespacedIntegrationGroup = `${string}/${string}`;
export type AnyIntegrationGroup = IntegrationGroup | NamespacedIntegrationGroup;

const NAMESPACED_GROUP = /^([a-z0-9][a-z0-9-]*)\/[a-z0-9][a-z0-9-]*$/;

export function isBuiltInIntegrationGroup(group: string): group is IntegrationGroup {
	return (BUILT_IN_INTEGRATION_GROUPS as readonly string[]).includes(group);
}

/**
 * A built-in group, or a well-formed `<namespace>/<group>` whose namespace is
 * not itself a built-in group name (`database/x` would read as shadowing one).
 */
export function isIntegrationGroupName(group: string): group is AnyIntegrationGroup {
	if (isBuiltInIntegrationGroup(group)) return true;
	const namespace = NAMESPACED_GROUP.exec(group)?.[1];
	return !!namespace && !isBuiltInIntegrationGroup(namespace);
}

/** Group or variant the registry does not know, named in the message. */
export class UnknownIntegrationVariantError extends Error {
	constructor(
		readonly group: string,
		readonly variant?: string,
	) {
		super(
			variant === undefined
				? `Unknown integration group "${group}"`
				: `Unknown integration variant "${variant}" for group "${group}"`,
		);
		this.name = "UnknownIntegrationVariantError";
	}
}

/** What an op hook is handed besides the config. */
export type IntegrationOpContext = {
	/** `KEY` -> value, for each app config key the config references, in its environment */
	appConfig: Map<string, string>;
	/** what the caller asked for: observability's `signal`, a saved mcp integration's `oauth` */
	options: Record<string, unknown>;
	/** fires when the caller cancels the op (Test connection's Cancel); stop the work and release the connection */
	signal?: AbortSignal;
};

/** A Test connection's answer. A failure says why in `error`. */
export type IntegrationTestResult = {
	success: boolean;
	error?: string;
	/** connected, but something will not work (a MongoDB server with no replica set) */
	warning?: string;
	/** mcp only: what the server exposes */
	tools?: Array<{ name: string; description: string }>;
};

/** A database variant's pooled client, opened once per integration and leased per request. */
export type DatabasePool = { db: unknown; close(): Promise<void> };

export type DatabaseVariantExtras = {
	/** editor a hand-written condition gets: SQL text, or JS returning a native filter */
	conditionEditor: "sql" | "js";
	/** the runtime `Connection.dbType` this variant resolves to; unique per variant */
	dbType: string;
};

/** What `create` takes and returns, per built-in group. */
interface BuiltInGroupSpecs {
	database: {
		config: Connection;
		ctx: { pool: DatabasePool };
		adapter: DatabaseAdapter;
		/** the tables and columns pickers offer */
		describe: { tables: IntrospectedTable[] };
		inspect: SchemaDetails;
	};
	kv: {
		config: KvConnectionConfig;
		ctx: Record<string, never>;
		/** the factory caches one client per integration and closes it on change */
		adapter: KvAdapter & { disconnect(): Promise<void> };
		describe: unknown;
		inspect: unknown;
	};
	queue: {
		config: Record<string, any>;
		/** the producer factory's connector loader, so tests can stub the broker */
		ctx: { loadConnector(type: string): Promise<QueueConnector> };
		adapter: Promise<QueueProducer>;
		describe: unknown;
		inspect: unknown;
	};
	ai: {
		config: any;
		ctx: Record<string, never>;
		adapter: AiAdapter;
		describe: unknown;
		inspect: unknown;
	};
	observability: {
		config: any;
		ctx: Record<string, never>;
		adapter: ObservabilityAdapter;
		describe: unknown;
		inspect: unknown;
	};
	baas: {
		config: any;
		ctx: Record<string, never>;
		adapter: BaasAdapter;
		describe: unknown;
		inspect: unknown;
	};
	mcp: {
		config: any;
		ctx: Record<string, never>;
		adapter: McpAdapter;
		describe: unknown;
		inspect: unknown;
	};
}

type PluginGroupSpec = {
	config: any;
	ctx: Record<string, unknown>;
	adapter: unknown;
	describe: unknown;
	inspect: unknown;
};

type SpecOf<G extends AnyIntegrationGroup> = G extends IntegrationGroup
	? BuiltInGroupSpecs[G]
	: PluginGroupSpec;

/** what a variant of group `G` answers `describe` and `inspect` with */
export type VariantHookResult<
	G extends AnyIntegrationGroup,
	Op extends "describe" | "inspect",
> = SpecOf<G>[Op];

/**
 * The serializable half of a variant: what it is called and which config it
 * accepts. Pure, so the admin, the portal and the AI gateway can read it without
 * loading a driver. A database variant has to say which condition editor it
 * gets — leaving it out is a type error, not a builder offering the wrong language.
 */
export type IntegrationVariantMeta<G extends AnyIntegrationGroup = AnyIntegrationGroup> =
	G extends unknown
		? {
				group: G;
				variant: string;
				label: string;
				icon?: string;
				/** older names still stored on rows; looked up as this variant, never listed */
				aliases?: readonly string[];
				/** what the variant can do, for pickers that filter on it */
				tags?: readonly string[];
				/** the plugin that provides it (`scope/name`); absent on a built-in */
				plugin?: string;
				/** the stored (form) config, validated on create, update and test */
				configSchema: z.ZodType;
				/** plugin variants: the raw params from manifest, for portal forms */
				params?: Record<string, unknown>;
				/** plugin variants: tab names */
				tabs?: readonly string[];
				hasTest?: boolean;
				hasDescribe?: boolean;
				hasInspect?: boolean;
				description?: string;
				docs?: string;
			} & (G extends "database"
				? { extras: DatabaseVariantExtras }
				: { extras?: Record<string, unknown> })
		: never;

/**
 * One integration variant: its metadata plus the hooks that turn a config into
 * an adapter. Built-ins fill the registry at startup; plugins (I6) register more.
 */
export type IntegrationVariantDef<G extends AnyIntegrationGroup = AnyIntegrationGroup> =
	G extends unknown
		? IntegrationVariantMeta<G> & {
				/**
				 * Stored config -> the runtime config the caches hold, `cfg:` references
				 * expanded from `appConfig`. Left out, every field is expanded as is.
				 */
				resolve?(stored: any, appConfig: Record<string, any> | undefined): any;
				/** runtime config -> adapter, through the group's factory */
				create?(config: SpecOf<G>["config"], ctx: SpecOf<G>["ctx"]): SpecOf<G>["adapter"];
				/**
				 * The op hooks (I3): Test connection, metadata and inspect. Each gets the
				 * stored config (validated, `cfg:` references unresolved) and the
				 * environment's values of the keys it references in `ctx.appConfig`. They
				 * run on a worker of the integration's environment, or in the admin for
				 * a built-in.
				 */
				test?(config: any, ctx: IntegrationOpContext): Promise<IntegrationTestResult>;
				describe?(config: any, ctx: IntegrationOpContext): Promise<SpecOf<G>["describe"]>;
				inspect?(
					config: any,
					request: any,
					ctx: IntegrationOpContext,
				): Promise<SpecOf<G>["inspect"]>;
				/** validates `inspect`'s request before the hook sees it */
				inspectRequest?: z.ZodType;
				/**
				 * What decides which client `ctx.integrations` pools: configs with the
				 * same key share one. Left out, the whole config is the key.
				 */
				poolKey?(config: SpecOf<G>["config"]): unknown;
				/** closes a client `create` made when its pool slot idles out or the worker stops */
				close?(client: SpecOf<G>["adapter"]): unknown;
			} & (G extends "database"
					? {
							/** opens the pooled client the factory leases to `create` */
							connect(config: Connection): DatabasePool;
							create(config: Connection, ctx: { pool: DatabasePool }): DatabaseAdapter;
						}
					: unknown)
		: never;

/**
 * A permission or a `param.integration` kind: a group (`database`, `acme/store`)
 * or one variant of it (`database/PostgreSQL`, `acme/store/Fancy`).
 */
export function parseIntegrationKind(
	kind: string,
): { group: AnyIntegrationGroup; variant?: string } | undefined {
	const builtIn = BUILT_IN_INTEGRATION_GROUPS.find((g) => kind === g || kind.startsWith(`${g}/`));
	if (builtIn)
		return {
			group: builtIn,
			...(kind === builtIn ? {} : { variant: kind.slice(builtIn.length + 1) }),
		};
	const [namespace, group, ...rest] = kind.split("/");
	const name = `${namespace}/${group}`;
	if (!group || !isIntegrationGroupName(name)) return undefined;
	return { group: name, ...(rest.length ? { variant: rest.join("/") } : {}) };
}

/** Whether a granted `kind` reaches an integration of `group` and `variant`. */
export function integrationKindCovers(kind: string, group: string, variant: string) {
	return kind === group || kind === `${group}/${variant}`;
}
