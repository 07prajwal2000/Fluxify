import { requestBodySchema as appConfigBody } from "@fluxify/server/src/api/v1/app-config/create/dto";
import { baseRequestBodySchema as customBlockBody } from "@fluxify/server/src/api/v1/custom-blocks/create/dto";
import {
	getIntegrationsGroups,
	getIntegrationsVariants,
} from "@fluxify/server/src/api/v1/integrations/helpers";
import { integrationsGroupSchema } from "@fluxify/server/src/api/v1/integrations/schemas";
import { createBodySchema as middlewareBody } from "@fluxify/server/src/api/v1/middlewares/dto";
import {
	createSchema as triggerCreate,
	patchSchema as triggerPatch,
} from "@fluxify/server/src/api/v1/triggers/dto";
import { z } from "zod";
import { type McpTool, projectId } from "./tools";

/**
 * The server's own request fields, all optional and without defaults. One
 * tool both creates and updates, so a default would overwrite a value the
 * caller never meant to change; the server still says what a create is missing.
 */
export function optionalFields(shape: z.ZodRawShape): z.ZodRawShape {
	return Object.fromEntries(
		Object.entries(shape).map(([key, field]) => {
			let inner: any = field;
			while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault)
				inner = inner.unwrap();
			return [key, inner.optional()];
		}),
	);
}

const SAVE = { readOnlyHint: false, destructiveHint: false };
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

const idArg = (what: string) =>
	z.string().optional().describe(`${what} id to update; omit to create`);

const VARIANTS = getIntegrationsGroups()
	.map((g) => [g, getIntegrationsVariants(g)] as const)
	.filter(([, v]) => v.length)
	.map(([g, v]) => `${g}: ${v.join(", ")}`)
	.join("; ");

/** Drops keys whose value is undefined, so an update sends only what changed. */
const defined = (o: Record<string, unknown>) =>
	Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

export const writeTools: McpTool[] = [
	{
		name: "save_trigger",
		description:
			"Create or update a trigger. To create pass projectId, name and type ('internal' is started by workflows, 'schedule' needs schedule: '@every 5m', '@daily' or six-field cron with seconds first; queue types need integrationId and source). On update pass triggerId and only what changes; type and project cannot change. workflowId null detaches the workflow.",
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
		description:
			"Create or update a custom block's details: label, description, inputs (inputParams) and docs. Its code is not set here. To create pass projectId, name (lowercase letters, digits, _) and label. name and usage (where it may run, 'flow' by default) cannot change after create.",
		role: "creator",
		annotations: SAVE,
		input: { customBlockId: idArg("Custom block"), ...optionalFields(customBlockBody.shape) },
		call: async ({ send }, { customBlockId, projectId: p, name, usage, ...a }) => {
			const { id } = customBlockId
				? await send("PUT", `/v1/custom-blocks/${customBlockId}`, a)
				: await send("POST", "/v1/custom-blocks", { projectId: p, name, usage, ...a });
			return { id };
		},
	},
	{
		name: "delete_custom_block",
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
		description:
			"Create or update an app config entry (a setting or secret blocks read). To create pass keyName, value, description, isEncrypted and encodingType ('plaintext' unless the value is already base64 or hex). Encrypt secrets: an encrypted value is never shown again and cannot be decrypted back. On update, fields left out keep their value; keyName and dataType cannot change.",
		role: "creator",
		annotations: SAVE,
		input: {
			projectId,
			appConfigId: z.number().int().optional().describe("App config id to update; omit to create"),
			...optionalFields(appConfigBody.shape),
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
			};
			return pickId(await send("PUT", `${base}/${appConfigId}`, defined(body)));
		},
	},
	{
		name: "delete_app_config",
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
		description: `Create or update an integration (a database, KV store, AI provider, queue, …). To create pass name, group, variant and config. Variants by group: ${VARIANTS}. config fields depend on the variant; get_integration on an existing one shows the shape, and a wrong config returns the fields to fix. Put secrets in app config and reference them as "cfg:KEY_NAME". On update, group and variant cannot change and config replaces the whole config.`,
		role: "creator",
		annotations: SAVE,
		input: {
			projectId,
			integrationId: idArg("Integration"),
			name: z.string().optional(),
			group: integrationsGroupSchema.optional(),
			variant: z.string().optional(),
			config: z.record(z.string(), z.unknown()).optional(),
		},
		call: async ({ get, send }, { projectId: p, integrationId, ...a }) => {
			const base = `/v1/${p}/integrations`;
			if (!integrationId) return pickId(await send("POST", base, a));
			// the server's update replaces name and config together
			const cur = a.name && a.config ? {} : await get(`${base}/${integrationId}`);
			const body = { name: a.name ?? cur.name, config: a.config ?? cur.config };
			return pickId(await send("PUT", `${base}/${integrationId}`, body));
		},
	},
	{
		name: "delete_integration",
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
		description:
			"Check that Fluxify can connect to an integration. Pass integrationId for a saved one, or group, variant and config to test before saving. Makes a real network call; changes nothing.",
		role: "creator",
		annotations: { readOnlyHint: true, openWorldHint: true },
		input: {
			projectId,
			integrationId: z.string().optional().describe("A saved integration's id"),
			group: integrationsGroupSchema.optional(),
			variant: z.string().optional(),
			config: z.record(z.string(), z.unknown()).optional(),
			signal: z
				.enum(["logs", "traces", "metrics"])
				.optional()
				.describe("Observability only: which signal to probe, logs by default"),
		},
		call: async ({ get, send }, { projectId: p, integrationId, signal, ...a }) =>
			integrationId
				? get(`/v1/${p}/integrations/test-existing-connection/${integrationId}`, { signal })
				: send("POST", `/v1/${p}/integrations/test-connection`, a),
	},
];

function pickId(body: { id: unknown } | null) {
	return { id: body?.id };
}
