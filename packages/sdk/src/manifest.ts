import { z } from "zod";
import { handleSpecSchema } from "./handles.js";
import type { Condition, VisibleWhenInput } from "./params.js";
import { CTX_SPAN_TYPE, ICON_URL_MAX, INVOKE_MODES } from "./reserved.js";
import { checkEntry, RESERVED_PARAM_NAMES } from "./validate.js";

const scalar = z.union([z.string(), z.number(), z.boolean()]);

export const visibleWhenSchema: z.ZodType<VisibleWhenInput> = z.lazy(() =>
	z.union([
		z.strictObject({ all: z.array(visibleWhenSchema).min(1) }),
		z.strictObject({ any: z.array(visibleWhenSchema).min(1) }),
		z.record(z.string(), z.union([scalar, z.array(scalar).min(1)])),
	]),
);

/** where it shows in the settings panel; old manifests have neither, and render as one General tab */
const placement = {
	tab: z.string().min(1).optional(),
	order: z.number().optional(),
};
const common = {
	label: z.string().optional(),
	description: z.string().optional(),
	required: z.boolean().optional(),
	visibleWhen: visibleWhenSchema.optional(),
	deprecated: z.string().min(1).optional(),
	...placement,
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
	z.strictObject({
		type: z.literal("keyValue"),
		...common,
		default: z.record(z.string(), z.json()).optional(),
		keys: z.strictObject({ placeholder: z.string().optional() }).optional(),
	}),
	z
		.strictObject({
			type: z.literal("array"),
			...common,
			default: z.array(z.json()).optional(),
			of: z.string().min(1).optional(),
			min: z.int().nonnegative().optional(),
			max: z.int().positive().optional(),
		})
		.refine((p) => p.min === undefined || p.max === undefined || p.min <= p.max, {
			message: "array min must not be above max",
			path: ["min"],
		}),
	bare("fieldMap"),
	z.strictObject({
		type: z.literal("hint"),
		/** markdown */
		text: z.string().min(1),
		tone: z.enum(["info", "tip", "warning"]).optional(),
		visibleWhen: visibleWhenSchema.optional(),
		...placement,
	}),
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
		/** the settings tabs in order (see `paramTabs`) */
		tabs: z
			.array(z.string().min(1))
			.refine((t) => new Set(t).size === t.length, "tabs must be unique")
			.optional(),
		handles: handleSpecSchema,
		deprecated: z.string().min(1).nullable(),
	})
	.superRefine(checkEntry);

export type ManifestEntry = z.infer<typeof manifestEntrySchema>;

/** scope/name: the plugin's permanent identity */
export const PLUGIN_NAME = /^[a-z0-9][a-z0-9_-]*\/[a-z0-9][a-z0-9_-]*$/;
/** the SDK versions a plugin works with: `>=`, `^` or `~` and one version, or an exact one */
export const SDK_RANGE = /^(>=|\^|~)?\d+\.\d+\.\d+$/;

/** where a block's built module sits in the plugin: `scope/name/a/b` is `dist/blocks/a/b.js` */
export const blockEntryPath = (type: string) =>
	`dist/blocks/${type.split("/").slice(2).join("/")}.js`;

/** an icon path inside the plugin, or a data URL; either way no longer than a custom block icon may be */
const icon = z.string().min(1).max(ICON_URL_MAX);

/**
 * What a plugin says about itself: `plugin({...})` in its `src/index.ts`, and
 * the top of `fluxify.json`. `name` is the plugin's permanent identity.
 */
export const pluginMetaSchema = z.strictObject({
	name: z.string().regex(PLUGIN_NAME, "must be scope/name: lowercase letters, digits, - and _"),
	url: z.url({ protocol: /^https$/, error: "must be an https:// URL" }),
	/** the plugin's folder in the block picker */
	icon: icon.optional(),
	/** the scope's folder; when the project's plugins of one scope disagree, the latest approved wins */
	scopeIcon: icon.optional(),
	description: z.string().min(1).optional(),
});
export type PluginMeta = z.infer<typeof pluginMetaSchema>;

/**
 * `fluxify.json`, the manifest at the root of a plugin package: written by the
 * CLI, validated by the admin registry, rendered by the portal. A block's
 * `entry` is fixed by its type, so a manifest cannot point outside `dist/blocks`.
 */
export const fluxifyManifestSchema = pluginMetaSchema
	.extend({
		sdk: z.string().regex(SDK_RANGE, "must be a version range like >=2026.10.2001"),
		blocks: z.record(z.string(), manifestEntrySchema.and(z.object({ entry: z.string() }))),
	})
	.superRefine((m, ctx) => {
		for (const [type, b] of Object.entries(m.blocks)) {
			const issue = (message: string, path: string[]) =>
				ctx.addIssue({ code: "custom", message, path: ["blocks", type, ...path] });
			if (b.name !== type) issue(`is keyed '${type}' but named '${b.name}'`, ["name"]);
			else if (!type.startsWith(`${m.name}/`)) issue(`is not inside plugin '${m.name}'`, ["name"]);
			else if (b.entry !== blockEntryPath(type))
				issue(`must be '${blockEntryPath(type)}'`, ["entry"]);
		}
	});

export type FluxifyManifest = z.infer<typeof fluxifyManifestSchema>;
