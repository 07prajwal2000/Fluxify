import { z } from "zod";
import { requestBodySchema } from "../create/dto";
import { projectSettingsKeySchemaMap } from "../settings/keys/keySchemaMap";

/** something the user should know about restoring a section here; never stops a restore */
export const warningSchema = z.object({ section: z.string(), message: z.string() });

const canvasSchema = z.object({
	blocks: z.array(
		z.object({
			id: z.string(),
			type: z.string(),
			position: z.object({ x: z.number(), y: z.number() }),
			data: z.unknown(),
		}),
	),
	edges: z.array(
		z.object({
			id: z.string(),
			from: z.string(),
			to: z.string(),
			fromHandle: z.string().nullable(),
			toHandle: z.string().nullable(),
		}),
	),
});

/** one resource of a section, read only; never a secret */
const previewItemSchema = z.object({
	name: z.string(),
	summary: z.string().optional(),
	details: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
		.optional(),
	canvas: canvasSchema.optional(),
});

export const inspectResponseSchema = z.object({
	mode: z.enum(["backup", "template"]),
	release: z.string(),
	createdAt: z.string(),
	source: z.object({ name: z.string(), slug: z.string() }),
	/** section → its format version */
	sections: z.record(z.string(), z.number()),
	encrypted: z.boolean(),
	/** the author's Markdown note: untrusted, render it as Markdown only */
	readme: z.string().nullable(),
	warnings: z.array(warningSchema),
	/** what each section holds, in import order */
	preview: z.array(z.object({ section: z.string(), items: z.array(previewItemSchema) })),
	/** the source's name and slug, made unique on this instance */
	suggested: z.object({ name: z.string(), slug: z.string() }),
});

export const restoreResponseSchema = z.object({ id: z.string(), warnings: z.array(warningSchema) });

/**
 * What the new project is given, as "create project" takes it. A multipart form
 * is flat, so the subdomain is its own field; the route files it as the
 * project's setting, which then stands over the archive's own value.
 */
export const newProjectSchema = requestBodySchema
	.pick({ name: true, slug: true, description: true })
	.extend({
		subdomain: projectSettingsKeySchemaMap["settings.routing.subdomain"].schema.optional(),
	});
