import z from "zod";
import { PLUGIN_APPROVALS, PLUGIN_SOURCES, PLUGIN_URL_STATUSES } from "../../../db/schema";

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

export const npmBodySchema = z.object({
	/** `name@x.y.z` or `@scope/name@x.y.z`: an exact version, never a range or a tag */
	spec: z.string().min(1).max(300),
});
export const urlBodySchema = z.object({ url: z.string().min(1).max(2000) });
export const urlParamSchema = z.object({ id: z.string() });
export const fsBodySchema = z.object({
	/** a directory name from `GET fs/discover` */
	path: z.string().min(1).max(255),
});

export const urlRequestSchema = z.object({
	id: z.string(),
	projectId: z.string(),
	url: z.string(),
	status: z.enum(PLUGIN_URL_STATUSES),
	requestedBy: z.string(),
	fetchedBy: z.string().nullable(),
	/** the plugin the fetch registered */
	pluginName: z.string().nullable(),
	lastError: z.string().nullable(),
	createdAt: z.coerce.string(),
	updatedAt: z.coerce.string(),
});

export const fsCandidatesSchema = z.array(
	z.object({
		path: z.string(),
		name: z.string().optional(),
		version: z.string().optional(),
		error: z.string().optional(),
	}),
);

const installStateSchema = z.object({
	version: z.string(),
	integrity: z.string(),
	state: z.enum(["installing", "ready", "error"]),
	error: z.string().optional(),
	failedImports: z.array(z.object({ name: z.string(), error: z.string() })).optional(),
});

export const installStatusSchema = z.object({
	version: z.string(),
	integrity: z.string(),
	/** every live node in an environment the plugin is enabled in has installed this version */
	done: z.boolean(),
	/** a node failed to install this version; the plugin's status and last error say which */
	failed: z.boolean(),
	nodes: z.array(
		z.object({
			nodeId: z.string(),
			type: z.string(),
			env: z.string(),
			/** null until the node reports */
			status: installStateSchema.nullable(),
		}),
	),
});
