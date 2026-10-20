import z from "zod";
import { PLUGIN_APPROVALS, PLUGIN_SOURCES } from "../../../db/schema";

export const projectQuerySchema = z.object({ projectId: z.string() });
/** a plugin's `scope/name`, as two path segments */
export const nameParamSchema = z.object({ scope: z.string(), name: z.string() });

export const approveBodySchema = z.object({
	/** the integrity the creator reviewed; a plugin that changed since is refused (409) */
	integrity: z.string().optional(),
});

export const environmentsBodySchema = z.object({ dev: z.boolean(), prod: z.boolean() });

export const pluginSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	name: z.string(),
	version: z.string(),
	source: z.enum(PLUGIN_SOURCES),
	location: z.string(),
	integrity: z.string(),
	url: z.string(),
	sdkRange: z.string(),
	/** `fluxify.json`: its blocks, their params, handles, docs and permissions */
	manifest: z.record(z.string(), z.unknown()),
	approval: z.enum(PLUGIN_APPROVALS),
	/** who approved or rejected it, and when */
	approvedBy: z.string().nullable(),
	approvedAt: z.coerce.string().nullable(),
	/** what the approval granted; null until approved */
	permissions: z.object({ integrations: z.array(z.string()), appconfig: z.boolean() }).nullable(),
	devEnabled: z.boolean(),
	prodEnabled: z.boolean(),
	status: z.enum(["ok", "error"]),
	lastError: z.string().nullable(),
	scannedAt: z.coerce.string().nullable(),
	createdAt: z.coerce.string(),
	updatedAt: z.coerce.string(),
});

export const listResponseSchema = z.array(pluginSchema);
