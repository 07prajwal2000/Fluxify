import { z } from "zod";
import { type CheckVisible, placeParams, prepareParams } from "./block.js";
import type { Logger } from "./context.js";
import type { BuiltInIntegrationAdapters } from "./integrations/index.js";
import {
	type DatabaseVariantExtras,
	type IntegrationGroup,
	type IntegrationTestResult,
	isBuiltInIntegrationGroup,
} from "./integrations/variants.js";
import { type IntegrationEntry, integrationEntrySchema } from "./manifest.js";
import type { JsonValue, Param, ParamValues } from "./params.js";
import type { CONFIG_PARAM_TYPES } from "./validateIntegration.js";

/** the params an integration's config takes (see `CONFIG_PARAM_TYPES`) */
export type ConfigParams = Record<
	string,
	Extract<Param, { type: (typeof CONFIG_PARAM_TYPES)[number] }>
>;

/** What `connect` gets besides the config. */
export type ConnectContext = {
	/**
	 * The value of an app config key that one of this integration's own secret
	 * fields names, in the integration's environment. Any other key throws.
	 */
	getConfig(key: string): string;
	logger: Logger;
	/** aborted once the client is closed, or the Test connection / inspect that opened it is done */
	signal: AbortSignal;
};

/** what a variant of a built-in group must hand out; a plugin's own group hands out anything */
export type GroupContract<G extends string> = G extends IntegrationGroup
	? BuiltInIntegrationAdapters[G]
	: unknown;

type Awaitable<T> = T | Promise<T>;

export type IntegrationDefinition<
	G extends string = string,
	P extends ConfigParams = ConfigParams,
	C = unknown,
	R extends z.ZodType = z.ZodType,
> = {
	/** `scope/name/<path>`, like a block's type: the plugin name plus its path under `src/integrations` */
	name: string;
	label: string;
	description?: string;
	/** a path inside the plugin, e.g. `./icons/hub.svg` */
	icon: string;
	/** markdown for the integration's page */
	docs?: string;
	/**
	 * A built-in group (`"database"`, `"kv"`, ...): `connect` must hand out that
	 * group's adapter, and the built-in blocks use it. Any other name is this
	 * plugin's own group; Fluxify files it under the plugin's scope (`acme/crm`).
	 */
	group: G;
	/** the variant's name in its group, as the integrations page lists it */
	variant: string;
	/** the form: the same `param.*` builders as a block's params, plus `param.secret()` */
	config: P;
	/** the form's tabs in order; default: in order of first use, General first */
	tabs?: readonly string[];
	/** which configs share a client; default: the whole config, secrets' values included */
	poolKey?(config: ParamValues<P>): unknown;
	/** opens the client. A secret field holds its app config key: read the value with `ctx.getConfig` */
	connect(config: ParamValues<P>, ctx: ConnectContext): Awaitable<C>;
	/** Test connection on a fresh client; a throw fails it with the message. Left out, the page has no Test button */
	test?(client: C, config: ParamValues<P>): Awaitable<IntegrationTestResult | void>;
	/** metadata for pickers and the AI agent (a database: `{ tables }`) */
	describe?(client: C, config: ParamValues<P>): Awaitable<unknown>;
	/** answers one request (a database: a table's schema); `inspectRequest` checks the request first */
	inspect?(client: C, request: z.infer<R>, config: ParamValues<P>): Awaitable<unknown>;
	inspectRequest?: R;
	/** closes a client when its pool slot idles out, the worker stops, or a Test connection is done */
	close?(client: C): unknown;
} & (G extends "database"
	? { extras: DatabaseVariantExtras }
	: { extras?: Record<string, JsonValue> });

/** any `integration(...)` result */
export type AnyIntegration = IntegrationDefinition<string, ConfigParams, any, any>;

/** `acme/crm` for a plugin's own group `crm` of `acme/...`; a built-in group as is */
export const integrationGroup = (def: { name: string; group: string }) =>
	isBuiltInIntegrationGroup(def.group) ? def.group : `${def.name.split("/")[0]}/${def.group}`;

/** The definition minus its hooks, as manifest data. */
export function toIntegrationEntry(def: AnyIntegration): IntegrationEntry {
	const { params, tabs } = placeParams({ params: def.config, tabs: def.tabs });
	const entry = {
		name: def.name,
		label: def.label,
		description: def.description,
		icon: def.icon,
		docs: def.docs,
		group: integrationGroup(def),
		variant: def.variant,
		extras: def.extras,
		configSchema: params,
		tabs,
		secretParams: Object.keys(def.config).filter((k) => def.config[k]!.type === "secret"),
		hasTest: typeof def.test === "function",
		hasDescribe: typeof def.describe === "function",
		hasInspect: typeof def.inspect === "function",
	};
	return JSON.parse(JSON.stringify(entry));
}

/** a stored secret: `cfg:<KEY>`, the way every integration field names app config */
const SECRET_REF = "cfg:";
export const secretKey = (stored: string) =>
	stored.startsWith(SECRET_REF) ? stored.slice(SECRET_REF.length) : stored;
export const secretRef = (key: string) => (key.startsWith(SECRET_REF) ? key : SECRET_REF + key);

/**
 * The stored config's validator, from its params: what the admin checks on
 * create, update and Test connection. A secret must be a `cfg:<KEY>` reference;
 * every other param is checked by `prepareParams`, the rules block params run by.
 */
export function paramsConfigSchema(params: Record<string, Param>): z.ZodType {
	return z.record(z.string(), z.unknown()).superRefine((stored, ctx) => {
		const values = { ...stored };
		for (const [name, p] of Object.entries(params)) {
			const value = values[name];
			if (p.type !== "secret" || value === undefined || value === null) continue;
			if (typeof value !== "string" || !value.startsWith(SECRET_REF) || value === SECRET_REF)
				ctx.addIssue({
					code: "custom",
					message: "must be an app config key reference, cfg:<KEY>",
					path: [name],
				});
			values[name] = secretKey(String(value));
		}
		try {
			prepareParams(params as never, values);
		} catch (error) {
			ctx.addIssue({ code: "custom", message: (error as Error).message });
		}
	});
}

const prettify = (name: unknown, error: z.ZodError) =>
	new Error(`integration ${String(name)}: ${z.prettifyError(error)}`);

/**
 * Defines an integration variant. Default-export the result from a file under
 * `src/integrations`. Throws on an invalid definition, naming it. A variant of a
 * built-in group must hand out that group's adapter: `connect` returning less
 * is a type error.
 */
export function integration<
	const G extends string,
	const P extends ConfigParams,
	C extends GroupContract<G>,
	R extends z.ZodType = z.ZodType,
>(
	def: IntegrationDefinition<G, P, C, R> & { config: NoInfer<CheckVisible<P>> },
): IntegrationDefinition<G, P, C, R> {
	if (def.group.includes("/"))
		throw new Error(
			`integration ${def.name}: group '${def.group}' must be a built-in group or a plain name; the scope is added for you`,
		);
	const parsed = integrationEntrySchema.safeParse(toIntegrationEntry(def as AnyIntegration));
	if (!parsed.success) throw prettify(def.name, parsed.error);
	return def;
}
