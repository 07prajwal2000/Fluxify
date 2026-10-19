import { z } from "zod";
import { handleSpecSchema } from "./handles.js";
import type { Condition, VisibleWhenInput } from "./params.js";
import { CTX_SPAN_TYPE, INVOKE_MODES } from "./reserved.js";
import { checkEntry, RESERVED_PARAM_NAMES } from "./validate.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const visibleWhenSchema: z.ZodType<VisibleWhenInput> = z.lazy(() =>
	z.union([
		z.strictObject({ all: z.array(visibleWhenSchema).min(1) }),
		z.strictObject({ any: z.array(visibleWhenSchema).min(1) }),
		z.record(z.string(), z.union([scalar, z.array(scalar).min(1)])),
	]),
);

const common = {
	label: z.string().optional(),
	description: z.string().optional(),
	required: z.boolean().optional(),
	visibleWhen: visibleWhenSchema.optional(),
	deprecated: z.string().min(1).optional(),
};
const typed = <T extends string, D extends z.ZodType>(type: T, value: D) =>
	z.strictObject({ type: z.literal(type), ...common, default: value.optional() });
/** params only the canvas can fill take no default */
const bare = <T extends string>(type: T) => z.strictObject({ type: z.literal(type), ...common });

const chain = z.enum(["and", "or"]);
const condition: z.ZodType<Condition> = z.lazy(() =>
	z.union([
		z.object({ group: z.array(condition), chain }),
		z.object({
			lhs: z.json().optional(),
			rhs: z.json().optional(),
			operator: z.enum(["eq", "neq", "gt", "gte", "lt", "lte", "js", "is_empty", "is_not_empty"]),
			js: z.string().optional(),
			chain,
		}),
	]),
);

/** One param of a manifest entry. */
export const paramSchema = z.discriminatedUnion("type", [
	typed("string", z.string()),
	typed("number", z.number()),
	typed("boolean", z.boolean()),
	z
		.strictObject({
			type: z.literal("select"),
			...common,
			options: z.array(z.string()).min(1),
			default: z.string().optional(),
		})
		.refine((p) => new Set(p.options).size === p.options.length, "select options must be unique")
		.refine((p) => p.default === undefined || p.options.includes(p.default), {
			message: "select default must be one of its options",
			path: ["default"],
		}),
	bare("js"),
	typed("json", z.json()),
	z.strictObject({ type: z.literal("integration"), ...common, kind: z.string().min(1) }),
	typed("appconfig", z.string()),
	typed("conditions", z.array(condition)),
	bare("schema"),
]);

/** scope/name(/folder)*: lowercase segments, at least scope, plugin and block */
export const BLOCK_NAME = /^[a-z0-9][a-z0-9_-]*(\/[a-z0-9][a-z0-9_-]*){2,}$/;

/**
 * A block as the plugin manifest (`fluxify.json`) holds it: the definition
 * minus `run`. The CLI writes it, the admin registry validates it, the portal
 * renders from it.
 */
export const manifestEntrySchema = z
	.strictObject({
		name: z
			.string()
			.refine((n) => n !== CTX_SPAN_TYPE, `'${CTX_SPAN_TYPE}' is reserved for traced spans`)
			.regex(BLOCK_NAME, "must be scope/name/.../block: lowercase letters, digits, - and _"),
		label: z.string().min(1),
		description: z.string().optional(),
		/** a path inside the plugin; its size is checked by the CLI */
		icon: z.string().min(1).optional(),
		shape: z.enum(["square", "wide"]),
		/** markdown, shown in the block's Docs tab */
		docs: z.string().optional(),
		invoke: z
			.array(z.enum(INVOKE_MODES))
			.min(1)
			.refine((m) => new Set(m).size === m.length, "invoke modes must be unique"),
		permissions: z.strictObject({
			integrations: z.array(z.string().min(1)).optional(),
			appconfig: z.boolean().optional(),
		}),
		params: z.record(z.string().min(1), paramSchema),
		handles: handleSpecSchema,
		deprecated: z.string().min(1).nullable(),
	})
	.superRefine(checkEntry);

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;
