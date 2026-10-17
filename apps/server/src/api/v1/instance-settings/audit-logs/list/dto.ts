import z from "zod";
import { AUDIT_SOURCES } from "../../../../../modules/audit/types";

export const requestQuerySchema = z.object({
	projectId: z
		.string()
		.max(50)
		.optional()
		.describe("only this project's events, also after the project was deleted"),
	actorId: z.string().max(100).optional(),
	actorEmail: z.string().max(320).optional().describe("part of the email, any case"),
	resourceType: z.string().max(50).optional(),
	action: z.string().max(50).optional(),
	source: z.enum(AUDIT_SOURCES).optional(),
	from: z.coerce.date().optional().describe("events at or after this time"),
	to: z.coerce.date().optional().describe("events before this time"),
	resourceId: z.string().max(100).optional().describe("part of the resource id, any case"),
	cursor: z
		.string()
		.max(300)
		.optional()
		.describe("the previous page's nextCursor, passed back unchanged"),
	limit: z.coerce.number().int().min(1).max(200).default(50).describe("events per page"),
});

export const auditRowSchema = z.object({
	id: z.uuid(),
	ts: z.iso.datetime(),
	actorId: z.string(),
	actorEmail: z.string(),
	source: z.enum(AUDIT_SOURCES),
	/** null for instance-level events */
	projectId: z.string().nullable(),
	/** the name when the event happened */
	projectName: z.string().nullable(),
	projectSlug: z.string().nullable(),
	/** true once the project no longer exists; its events stay */
	projectDeleted: z.boolean(),
	resourceType: z.string(),
	resourceId: z.string(),
	action: z.string(),
	/** property names only, never values */
	changedFields: z.array(z.string()),
	status: z.enum(["success", "failure"]),
	message: z.string().nullable(),
});

export const responseSchema = z.object({
	data: z.array(auditRowSchema),
	/** null on the last page */
	nextCursor: z.string().nullable(),
});
