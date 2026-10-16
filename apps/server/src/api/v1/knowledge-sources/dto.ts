import { z } from "zod";
import { KNOWLEDGE_SOURCE_TYPES } from "../../../db/schema";

export const projectParamSchema = z.object({ projectId: z.string() });
export const idParamSchema = projectParamSchema.extend({ id: z.string() });

/** Header name -> app config key. The value is read from app config at fetch time. */
const headersSchema = z
	.record(z.string().min(1).max(100), z.string().min(1).max(100))
	.describe("Request header name -> app config key holding its value");

export const bodySchema = z
	.object({
		name: z
			.string()
			.min(1)
			.max(100)
			.regex(/^[a-zA-Z0-9_-]+$/)
			.describe("Letters, numbers, - and _; part of the page paths agents see"),
		type: z.enum(KNOWLEDGE_SOURCE_TYPES),
		/** markdown: the document itself */
		content: z.string().max(1_000_000).optional(),
		url: z.url({ protocol: /^https?$/ }).optional(),
		headers: headersSchema.optional(),
		/** llms_txt: which linked pages to index, from the preview */
		selectedPages: z
			.array(z.url({ protocol: /^https?$/ }))
			.max(200)
			.optional(),
		enabled: z.boolean().optional(),
	})
	.superRefine((b, ctx) => {
		const need = (ok: unknown, path: string, message: string) =>
			!ok && ctx.addIssue({ code: "custom", path: [path], message });
		if (b.type === "markdown") need(b.content, "content", "Markdown sources need content");
		else need(b.url, "url", "URL sources need a url");
		if (b.type === "llms_txt")
			need(b.selectedPages?.length, "selectedPages", "Pick at least one page");
	});

export const previewBodySchema = z.object({
	url: z.url({ protocol: /^https?$/ }),
	headers: headersSchema.optional(),
});

export const previewResponseSchema = z.object({
	pages: z.array(z.object({ title: z.string(), url: z.string() })),
});

export const sourceSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.enum(KNOWLEDGE_SOURCE_TYPES),
	url: z.string().nullable(),
	headers: z.record(z.string(), z.string()),
	selectedPages: z.array(z.string()),
	enabled: z.boolean(),
	pageCount: z.number(),
	editedCount: z.number().optional(),
	lastFetchedAt: z.date().nullable(),
	lastFetchStatus: z.string().nullable(),
	lastFetchError: z.string().nullable(),
});

export const listResponseSchema = z.array(sourceSchema);
export const getResponseSchema = sourceSchema.extend({
	pages: z.array(
		z.object({
			url: z.string().optional(),
			markdown: z.string(),
			edited: z.boolean().optional(),
		}),
	),
});
export const idResponseSchema = z.object({ id: z.string() });

export const pageParamSchema = idParamSchema.extend({
	index: z.string().describe("0-based page index"),
});

export const pageBodySchema = z.object({
	markdown: z.string().max(1_000_000),
});
