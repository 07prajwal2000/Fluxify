import type { ZodType } from "zod";

type Scalar = string | number | boolean;

/**
 * When a param shows in the settings panel, as data (never an expression): a
 * param name -> the value (or any of the values) it must hold, or a group.
 * `block()` checks it against the block's own params.
 */
export type VisibleWhenInput =
	| { readonly all: readonly VisibleWhenInput[] }
	| { readonly any: readonly VisibleWhenInput[] }
	| { readonly [param: string]: Scalar | readonly Scalar[] };

type Common<D> = {
	label?: string;
	description?: string;
	/** `run` gets the value (or the run fails before it is called), so its type has no `undefined` */
	required?: boolean;
	/** used when the canvas left the param empty, so its type has no `undefined`; not on `js`, `integration` and `schema` params, which only the canvas can fill */
	default?: D;
	visibleWhen?: VisibleWhenInput;
	/** set by `deprecated(...)` */
	deprecated?: string;
} & Placement;

/** where a param (or a hint) shows in the settings panel; presentation only, `run` never sees it */
export type Placement = {
	/** the settings tab it shows in; default `General` */
	tab?: string;
	/** its position in the tab, ascending; params without one follow in declaration order */
	order?: number;
};

export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

/** One condition of a `conditions` param, as the Conditions builder stores it; `js:` sides arrive evaluated. */
export type Condition =
	| {
			lhs?: unknown;
			rhs?: unknown;
			operator: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "js" | "is_empty" | "is_not_empty";
			js?: unknown;
			chain: "and" | "or";
	  }
	| { group: Condition[]; chain: "and" | "or" };

/**
 * What a `schema` param arrives as: the zod schema built from the definition
 * (once per artifact and shared by every request, so a refinement must keep no
 * per-request state) and the definition itself.
 */
export type CompiledSchema = { zod: ZodType; schema: unknown };

export type StringParam = Common<string> & { type: "string" };
export type NumberParam = Common<number> & { type: "number" };
export type BooleanParam = Common<boolean> & { type: "boolean" };
export type SelectParam = Common<string> & { type: "select"; options: readonly string[] };
type NoDefault = Omit<Common<never>, "default">;

/** a JS expression the compiler evaluates per request; `run` gets the result */
export type JsParam = NoDefault & { type: "js" };
export type JsonParam = Common<JsonValue> & { type: "json" };
/** an integration of `kind` the user picks; `run` gets its id, for `ctx.integrations` */
export type IntegrationParam = NoDefault & {
	type: "integration";
	kind: string;
	/**
	 * Only these variants of the group (`["Redis"]`): the picker offers no
	 * other, the server refuses any other, and `ctx.integrations.connection`
	 * types `raw` as theirs. Left out, every variant of the group.
	 */
	variants?: readonly string[];
};

/** only a type: what an integration param's value carries for `connection` */
export declare const integrationBrand: unique symbol;

/**
 * An integration param's value: the integration's id, a plain string at run
 * time. Its type remembers the param's kind and `variants` (`never` when it
 * lists none), so `ctx.integrations.connection(id)` knows what it can be.
 */
export type IntegrationId<K extends string = string, V extends string = never> = string & {
	readonly [integrationBrand]?: { kind: K; variants: V };
};
/** an app config key the user picks; `run` gets the key, read it with `ctx.vars.getConfig` */
export type AppConfigParam = Common<string> & { type: "appconfig" };
/**
 * An integration's credential: the user picks an app config key and only the
 * key is stored. `connect` gets the key; read the value with `ctx.getConfig(key)`.
 * Integration config only; a block reads app config with `appconfig`.
 */
export type SecretParam = NoDefault & { type: "secret" };
export type ConditionsParam = Common<Condition[]> & { type: "conditions" };
/** a Fluxify schema definition (the schema builder's format), handed to `run` compiled */
export type SchemaParam = NoDefault & { type: "schema" };
/** rows of a key and a value; each value a literal or a `js:` expression, evaluated per value */
export type KeyValueParam = Common<Record<string, JsonValue>> & {
	type: "keyValue";
	keys?: { placeholder?: string };
};
/** a list; each item a literal or a `js:` expression, evaluated per item */
export type ArrayParam = Common<JsonValue[]> & {
	type: "array";
	/** what one item is, for the panel ("email" reads "Add email") */
	of?: string;
	min?: number;
	max?: number;
};
/** source key -> destination key, as the Transformer block maps; `run` gets `{ [destination]: input[source] }` */
export type FieldMapParam = NoDefault & { type: "fieldMap" };
/**
 * Not a param: markdown shown as a callout between the params of its tab.
 * It holds no value and never reaches `run`.
 */
export type HintParam = Placement & {
	type: "hint";
	text: string;
	tone?: "info" | "tip" | "warning";
	visibleWhen?: VisibleWhenInput;
};

export type Param =
	| StringParam
	| NumberParam
	| BooleanParam
	| SelectParam
	| JsParam
	| JsonParam
	| IntegrationParam
	| AppConfigParam
	| SecretParam
	| ConditionsParam
	| SchemaParam
	| KeyValueParam
	| ArrayParam
	| FieldMapParam
	| HintParam;

export type ParamType = Param["type"];
export type Params = Record<string, Param>;

type Options<T extends ParamType> = Omit<Extract<Param, { type: T }>, "type">;

const builder =
	<T extends Exclude<ParamType, "select" | "integration" | "hint">>(type: T) =>
	// NoInfer: `block()`'s visibleWhen check must not feed back into the options
	<const O extends Options<T>>(options?: O): { type: T } & NoInfer<O> =>
		({ ...options, type }) as { type: T } & O;

export const param = {
	string: builder("string"),
	number: builder("number"),
	boolean: builder("boolean"),
	select: <const V extends string, const O extends Omit<Options<"select">, "options" | "default">>(
		options: O & { options: readonly V[]; default?: NoInfer<V> },
	): { type: "select"; options: readonly V[] } & NoInfer<O> => ({ ...options, type: "select" }),
	js: builder("js"),
	json: builder("json"),
	integration: <const O extends Options<"integration">>(
		options: O,
	): { type: "integration" } & NoInfer<O> => ({
		...options,
		type: "integration",
	}),
	appconfig: builder("appconfig"),
	secret: builder("secret"),
	conditions: builder("conditions"),
	schema: builder("schema"),
	keyValue: builder("keyValue"),
	array: builder("array"),
	fieldMap: builder("fieldMap"),
};

/** A callout between the params of its tab: markdown, never a value. Declare it in `params`. */
export const hint = <const O extends Omit<HintParam, "type" | "text">>(
	text: string,
	options?: O,
): { type: "hint"; text: string } & NoInfer<O> =>
	({ ...options, type: "hint", text }) as { type: "hint"; text: string } & O;

/** The value `run` gets for a param. */
export type ParamValue<P> = P extends { type: "select"; options: readonly (infer V)[] }
	? V
	: P extends { type: "integration"; kind: infer K extends string }
		? IntegrationId<K, P extends { variants: readonly (infer V extends string)[] } ? V : never>
		: P extends { type: "string" | "appconfig" | "secret" }
			? string
			: P extends { type: "number" }
				? number
				: P extends { type: "boolean" }
					? boolean
					: P extends { type: "conditions" }
						? Condition[]
						: P extends { type: "schema" }
							? CompiledSchema
							: P extends { type: "keyValue" | "fieldMap" }
								? Record<string, unknown>
								: P extends { type: "array" }
									? unknown[]
									: unknown;

type Present<P> = P extends { required: true }
	? true
	: P extends { default: unknown }
		? true
		: false;
type Simplify<T> = { [K in keyof T]: T[K] } & {};

type Valued<P extends Params> = { [K in keyof P as P[K] extends HintParam ? never : K]: P[K] };

/** `run`'s `params`, inferred from the declaration; hints hold no value, so they are not in it. */
export type ParamValues<P extends Params, V extends Params = Valued<P>> = Simplify<
	{ -readonly [K in keyof V as Present<V[K]> extends true ? K : never]: ParamValue<V[K]> } & {
		-readonly [K in keyof V as Present<V[K]> extends true ? never : K]?: ParamValue<V[K]>;
	}
>;

/** a value `visibleWhen` can compare a param against; params of other types cannot be compared */
type Comparable<P> = P extends { type: "select"; options: readonly (infer V)[] }
	? V
	: P extends { type: "string" }
		? string
		: P extends { type: "number" }
			? number
			: P extends { type: "boolean" }
				? boolean
				: never;

/** `visibleWhen`, typed against the block's own params. */
export type VisibleWhen<P extends Params> =
	| { readonly [K in keyof P]?: Comparable<P[K]> | readonly Comparable<P[K]>[] }
	| { readonly all: readonly VisibleWhen<P>[] }
	| { readonly any: readonly VisibleWhen<P>[] };

/**
 * A declared `visibleWhen` (`W`) as it must be: every key a param of the block
 * and every value one that param can hold. Checked per key, so an unknown name
 * is an error rather than a stray extra property.
 */
export type CheckWhen<W, P extends Params> = W extends { readonly all: readonly (infer I)[] }
	? { readonly all: readonly CheckWhen<I, P>[] }
	: W extends { readonly any: readonly (infer I)[] }
		? { readonly any: readonly CheckWhen<I, P>[] }
		: {
				readonly [K in keyof W]: K extends keyof P
					? Comparable<P[K]> | readonly Comparable<P[K]>[]
					: never;
			};

/** the types `visibleWhen` can compare against */
export const COMPARABLE_TYPES: readonly ParamType[] = ["select", "string", "number", "boolean"];
