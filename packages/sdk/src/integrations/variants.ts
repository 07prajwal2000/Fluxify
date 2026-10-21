import type { z } from "zod";
import type { AiAdapter } from "./ai.js";
import type { BaasAdapter } from "./baas.js";
import type { Connection, DatabaseAdapter, SchemaDetails } from "./database.js";
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
		inspect: SchemaDetails;
	};
	kv: {
		config: KvConnectionConfig;
		ctx: Record<string, never>;
		/** the factory caches one client per integration and closes it on change */
		adapter: KvAdapter & { disconnect(): Promise<void> };
		inspect: unknown;
	};
	queue: {
		config: Record<string, any>;
		/** the producer factory's connector loader, so tests can stub the broker */
		ctx: { loadConnector(type: string): Promise<QueueConnector> };
		adapter: Promise<QueueProducer>;
		inspect: unknown;
	};
	ai: { config: any; ctx: Record<string, never>; adapter: AiAdapter; inspect: unknown };
	observability: {
		config: any;
		ctx: Record<string, never>;
		adapter: ObservabilityAdapter;
		inspect: unknown;
	};
	baas: { config: any; ctx: Record<string, never>; adapter: BaasAdapter; inspect: unknown };
	mcp: { config: any; ctx: Record<string, never>; adapter: McpAdapter; inspect: unknown };
}

type PluginGroupSpec = {
	config: any;
	ctx: Record<string, unknown>;
	adapter: unknown;
	inspect: unknown;
};

type SpecOf<G extends AnyIntegrationGroup> = G extends IntegrationGroup
	? BuiltInGroupSpecs[G]
	: PluginGroupSpec;

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
				/** the stored (form) config, validated on create, update and test */
				configSchema: z.ZodType;
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
				test?(config: any, appConfig: Record<string, any> | undefined): Promise<boolean>;
				inspect?(config: SpecOf<G>["config"]): Promise<SpecOf<G>["inspect"]>;
			} & (G extends "database"
					? {
							/** opens the pooled client the factory leases to `create` */
							connect(config: Connection): DatabasePool;
							create(config: Connection, ctx: { pool: DatabasePool }): DatabaseAdapter;
						}
					: unknown)
		: never;
