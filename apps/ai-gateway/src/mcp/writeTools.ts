import { integrationRegistry } from "@fluxify/adapters/integrations";
import { requestBodySchema as appConfigBody } from "@fluxify/server/src/api/v1/app-config/create/dto";
import { baseRequestBodySchema as customBlockBody } from "@fluxify/server/src/api/v1/custom-blocks/create/dto";
import { integrationGroupNameSchema } from "@fluxify/server/src/api/v1/integrations/schemas";
import { createBodySchema as middlewareBody } from "@fluxify/server/src/api/v1/middlewares/dto";
import {
	createSchema as triggerCreate,
	patchSchema as triggerPatch,
} from "@fluxify/server/src/api/v1/triggers/dto";
import { z } from "zod";
import { envInput, type McpTool, projectId } from "./tools";

/**
 * The server's own request fields, all optional and without defaults. One
 * tool both creates and updates, so a default would overwrite a value the
 * caller never meant to change; the server still says what a create is missing.
 */
export function optionalFields(shape: z.ZodRawShape): z.ZodRawShape {
	return Object.fromEntries(
		Object.entries(shape).map(([key, field]) => {
			let inner: any = field;
			let nullable = false;
			// a default can hide under .nullable() too (`.default([]).optional().nullable()`)
			while (
				inner instanceof z.ZodOptional ||
				inner instanceof z.ZodDefault ||
				inner instanceof z.ZodNullable
			) {
				if (inner instanceof z.ZodNullable) nullable = true;
				inner = inner.unwrap();
			}
			return [key, (nullable ? inner.nullable() : inner).optional()];
		}),
	);
}

const SAVE = { readOnlyHint: false, destructiveHint: false };
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

const idArg = (what: string) =>
	z.string().optional().describe(`${what} id to update; omit to create`);

// read once at load: the built-ins, which is what is registered before any plugin
const VARIANTS = integrationRegistry
	.groups()
	.map((g) => [g, integrationRegistry.variants(g).map((d) => d.variant)] as const)
	.filter(([, v]) => v.length)
	.map(([g, v]) => `${g}: ${v.join(", ")}`)
	.join("; ");

/** Drops keys whose value is undefined, so an update sends only what changed. */
const defined = (o: Record<string, unknown>) =>
	Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** Marks the fields an API create needs, so the MCP schema says what is required (#779). */
function requiredToCreate(shape: z.ZodRawShape, names: string[]): z.ZodRawShape {
	const set = new Set(names);
	return Object.fromEntries(
		Object.entries(shape).map(([key, field]) => {
			if (!set.has(key)) return [key, field];
			const note = "Required when creating.";
			const existing = (field as z.ZodType).description;
			return [key, (field as z.ZodType).describe(existing ? `${existing} ${note}` : note)];
		}),
	);
}

export const writeTools: McpTool[] = [
	{
		name: "save_trigger",
		title: "Save trigger",
		description:
			"Create or update a trigger. Triggers are shared by development and production, so saving one changes production: only when the user asks for it. To create pass projectId, name and type ('internal' is started by workflows, 'schedule' needs schedule: '@every 5m', '@daily' or six-field cron with seconds first; queue types need integrationId and source). On update pass triggerId and only what changes; type and project cannot change. workflowId null detaches the workflow. sandboxId runs one of your sandboxes instead of a workflow, on a development worker (not with 'schedule'); null detaches it.",
		role: "creator",
		annotations: SAVE,
		input: {
			triggerId: idArg("Trigger"),
			...optionalFields(triggerCreate.shape),
			...optionalFields(triggerPatch.shape),
		},
		call: async ({ send }, { triggerId, projectId: p, type, ...a }) => {
			const { id, warnings } = triggerId
				? await send("PATCH", `/v1/triggers/${triggerId}`, a)
				: await send("POST", "/v1/triggers", { projectId: p, type, ...a });
			return { id, warnings };
		},
	},
	{
		name: "delete_trigger",
		title: "Delete trigger",
		description: "Delete a trigger. Its workflow stays; nothing starts it from this trigger again.",
		role: "creator",
		annotations: DELETE,
		input: { triggerId: z.string().describe("Trigger id, from list_triggers") },
		call: async ({ send }, a) => {
			await send("DELETE", `/v1/triggers/${a.triggerId}`);
			return { deleted: a.triggerId };
		},
	},
	{
		name: "save_middleware",
		title: "Save middleware",
		description:
			"Create or update a middleware: a named chain of custom blocks (usage 'middleware') run before or after routes. To create pass projectId and name. blocks is custom block ids in run order and replaces the whole chain. Attaching it to routes is not done here.",
		role: "creator",
		annotations: SAVE,
		input: { middlewareId: idArg("Middleware"), ...optionalFields(middlewareBody.shape) },
		call: async ({ send }, { middlewareId, projectId: p, ...a }) =>
			middlewareId
				? send("PUT", `/v1/middlewares/${middlewareId}`, a)
				: send("POST", "/v1/middlewares", { projectId: p, ...a }),
	},
	{
		name: "delete_middleware",
		title: "Delete middleware",
		description: "Delete a middleware. It is also removed from every route that uses it.",
		role: "creator",
		annotations: DELETE,
		input: { middlewareId: z.string().describe("Middleware id, from list_middlewares") },
		call: async ({ send }, a) => {
			await send("DELETE", `/v1/middlewares/${a.middlewareId}`);
			return { deleted: a.middlewareId };
		},
	},
	{
		name: "save_custom_block",
		title: "Save custom block",
		description:
			'Create or update a custom block\'s details: label, description, inputs (inputParams) and docs. Its code is not set here. To create pass projectId, name (lowercase letters, digits, _) and label. name and usage (where it may run, \'flow\' by default) cannot change after create. Required to create: projectId (string), name (string, /^[a-z0-9_]+$/), label (string). Minimal create: { projectId: "p1", name: "my_block", label: "My Block" }.',
		role: "creator",
		annotations: SAVE,
		input: {
			customBlockId: idArg("Custom block"),
			...requiredToCreate(optionalFields(customBlockBody.shape), ["projectId", "name", "label"]),
		},
		call: async ({ send }, { customBlockId, projectId: p, name, usage, ...a }) => {
			const { id } = customBlockId
				? await send("PUT", `/v1/custom-blocks/${customBlockId}`, a)
				: await send("POST", "/v1/custom-blocks", { projectId: p, name, usage, ...a });
			return { id };
		},
	},
	{
		name: "extract_custom_block",
		title: "Extract custom block",
		description:
			"Turn blocks on a canvas into a new custom block in one call. Pass the canvas (from: { kind: route | workflow | custom_block | sandbox, id }), the block keys from get_canvas, a name (lowercase letters, digits, _) and a label. The new block holds those blocks (the same edges between them) with default details; the previous block's output is its input, and what its last block returns is its output. The selection must be tidy: one entry block, at most one edge into it, and at most one edge out of its single last block, with no other connections to the rest of the canvas. If it is not, the call is refused and says what to clean up: ask the user to tidy the canvas, do not rewire it yourself. replace (default false) swaps the selection on the source canvas for one instance of the new block and asks the user first, even in auto mode. Afterwards edit the details with save_custom_block.",
		role: "creator",
		annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
		input: {
			projectId,
			from: z.object({
				kind: z.enum(["route", "workflow", "custom_block", "sandbox"]),
				id: z.string().describe("The route, workflow, custom block or sandbox id"),
			}),
			keys: z.array(z.string()).min(1).describe("Block keys to extract, from get_canvas"),
			name: z.string().describe("Custom block name: lowercase letters, digits and _"),
			label: z.string().describe("Name shown in the block picker"),
			replace: z
				.boolean()
				.optional()
				.describe("Swap the selection for one instance of the new block; default false"),
		},
		call: async ({ send }, { from, ...a }) =>
			send("POST", "/v1/custom-blocks/extract", { ...a, source: from }),
	},
	{
		name: "delete_custom_block",
		title: "Delete custom block",
		description: "Delete a custom block and its code.",
		role: "creator",
		annotations: DELETE,
		input: { customBlockId: z.string().describe("Custom block id, from list_custom_blocks") },
		call: async ({ send }, a) => {
			await send("DELETE", `/v1/custom-blocks/${a.customBlockId}`);
			return { deleted: a.customBlockId };
		},
	},
	{
		name: "save_app_config",
		title: "Save app config",
		description:
			"Create or update an app config entry (a setting or secret blocks read). To create pass keyName, value, description, isEncrypted and encodingType ('plaintext' unless the value is already base64 or hex). value is production's: set it only when the user explicitly asks to change production, otherwise set devValue, development's own (null removes it), and syncDev true makes development read value instead. A development run with no devValue and syncDev off fails, naming the key. Encrypt secrets: an encrypted value is never shown again and cannot be decrypted back. On update, fields left out keep their value; keyName and dataType cannot change. Required to create: keyName (string, 3-100 chars, letters/digits/_), description (string, max 255), value (string, boolean or number), isEncrypted (boolean), encodingType ('plaintext', 'base64' or 'hex'). Minimal create: { projectId: \"p1\", keyName: \"GREETING\", value: \"hello\", description: \"\", isEncrypted: false, encodingType: \"plaintext\" }.",
		role: "creator",
		annotations: SAVE,
		input: {
			projectId,
			appConfigId: z.number().int().optional().describe("App config id to update; omit to create"),
			...requiredToCreate(optionalFields(appConfigBody.shape), [
				"keyName",
				"description",
				"value",
				"isEncrypted",
				"encodingType",
			]),
		},
		call: async ({ get, send }, { projectId: p, appConfigId, ...a }) => {
			const base = `/v1/${p}/app-config`;
			if (!appConfigId) return pickId(await send("POST", base, a));
			// the server's update replaces every field but the value
			const cur = await get(`${base}/${appConfigId}`);
			const body = {
				keyName: cur.keyName,
				description: a.description ?? cur.description,
				isEncrypted: a.isEncrypted ?? cur.isEncrypted,
				encodingType: a.encodingType ?? cur.encodingType,
				value: a.value,
				devValue: a.devValue,
				syncDev: a.syncDev,
			};
			return pickId(await send("PUT", `${base}/${appConfigId}`, defined(body)));
		},
	},
	{
		name: "delete_app_config",
		title: "Delete app config",
		description: "Delete an app config entry. Blocks and integrations that read it will fail.",
		role: "creator",
		annotations: DELETE,
		input: {
			projectId,
			appConfigId: z.number().int().describe("App config id, from list_app_config"),
		},
		call: async ({ send }, a) => {
			await send("DELETE", `/v1/${a.projectId}/app-config/${a.appConfigId}`);
			return { deleted: a.appConfigId };
		},
	},
	{
		name: "save_integration",
		title: "Save integration",
		description: `Create or update an integration (a database, KV store, AI provider, queue, …). To create pass name, group, variant and config. Variants by group: ${VARIANTS}. config fields depend on the variant: call get_integration_schema first for the exact fields, and a wrong config returns the fields to fix. Put secrets in app config and reference them as "cfg:KEY_NAME". config is production's: set it only when the user explicitly asks to change production, otherwise set devConfig, development's own, same fields (null removes it), and syncDev true makes development use config instead. Point devConfig at separate dev instances: a development run with no devConfig and syncDev off fails, naming the integration. On update, group and variant cannot change and config replaces the whole config.`,
		role: "creator",
		annotations: SAVE,
		input: {
			projectId,
			integrationId: idArg("Integration"),
			name: z.string().optional(),
			group: integrationGroupNameSchema.optional(),
			variant: z.string().optional(),
			config: z.record(z.string(), z.unknown()).optional(),
			devConfig: z.record(z.string(), z.unknown()).nullable().optional(),
			syncDev: z.boolean().optional(),
		},
		call: async ({ get, send }, { projectId: p, integrationId, ...a }) => {
			const base = `/v1/${p}/integrations`;
			if (!integrationId) return pickId(await send("POST", base, a));
			// the server's update replaces name and config together
			const cur = a.name && a.config ? {} : await get(`${base}/${integrationId}`);
			const body = {
				name: a.name ?? cur.name,
				config: a.config ?? cur.config,
				devConfig: a.devConfig,
				syncDev: a.syncDev,
			};
			return pickId(await send("PUT", `${base}/${integrationId}`, defined(body)));
		},
	},
	{
		name: "delete_integration",
		title: "Delete integration",
		description: "Delete an integration. Blocks and triggers that use it will fail.",
		role: "creator",
		annotations: DELETE,
		input: {
			projectId,
			integrationId: z.string().describe("Integration id, from list_integrations"),
		},
		call: async ({ send }, a) => {
			await send("DELETE", `/v1/${a.projectId}/integrations/${a.integrationId}`);
			return { deleted: a.integrationId };
		},
	},
	{
		name: "test_integration_connection",
		title: "Test integration connection",
		description:
			"Check that Fluxify can connect to an integration, with its development credentials (the production ones when it is set to Same as production). Production credentials can only be tested by a person in the portal. Pass integrationId for a saved one, or group, variant and config to test before saving; cfg: references read development app config. Makes a real network call; changes nothing.",
		role: "creator",
		annotations: { readOnlyHint: true, openWorldHint: true },
		input: {
			projectId,
			integrationId: z.string().optional().describe("A saved integration's id"),
			group: integrationGroupNameSchema.optional(),
			variant: z.string().optional(),
			config: z.record(z.string(), z.unknown()).optional(),
			signal: z
				.enum(["logs", "traces", "metrics"])
				.optional()
				.describe("Observability only: which signal to probe, logs by default"),
		},
		call: async ({ get, send }, { projectId: p, integrationId, signal, ...a }) =>
			// both answer a failed test as { success: false, error } (#690)
			integrationId
				? get(`/v1/${p}/integrations/test-existing-connection/${integrationId}`, { signal })
				: send("POST", `/v1/${p}/integrations/test-connection`, a),
	},
	{
		name: "get_integration_schema_details",
		title: "Get integration schema details",
		description:
			"What is inside a saved database integration (PostgreSQL, MySQL, MongoDB). Without tables: the table or collection names. With tables: columns (type, nullable, default), primary key, foreign keys and indexes; for MongoDB, indexes and field types inferred from ~20 sampled documents. Never returns row data. For config fields use get_integration_schema instead.",
		role: "creator",
		annotations: { readOnlyHint: true, openWorldHint: true },
		input: {
			projectId,
			integrationId: z.string().describe("A database integration's id, from list_integrations"),
			tables: z
				.array(z.string())
				.optional()
				.describe("Tables or collections to detail; omit to list names only"),
		},
		call: async ({ get }, a) =>
			get(`/v1/${a.projectId}/integrations/${a.integrationId}/schema`, {
				tables: a.tables?.join(","),
			}),
	},
	{
		name: "kv_get",
		title: "Read KV key",
		description:
			"Read one key from a saved KV integration (Redis, Memcached): its value (first 10,000 characters, truncated says if cut) and seconds until it expires (Redis only; Memcached cannot tell). Read only: to change or clear a key, do it from a route.",
		role: "creator",
		annotations: { readOnlyHint: true, openWorldHint: true },
		input: {
			projectId,
			integrationId: z.string().describe("A KV integration's id, from list_integrations"),
			key: z.string().min(1),
			env: envInput("Connects with that environment's credentials"),
		},
		call: async ({ get }, a) =>
			get(`/v1/${a.projectId}/integrations/${a.integrationId}/kv`, {
				key: a.key,
				env: a.env ?? "development",
			}),
	},
];

function pickId(body: { id: unknown } | null) {
	return { id: body?.id };
}
