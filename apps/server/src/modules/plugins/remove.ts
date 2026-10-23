import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { deleteArtifact } from "../../db/natsKv";
import { pluginObjects } from "../../db/natsObjects";
import { pluginsEntity, pluginUrlRequestsEntity } from "../../db/schema";
import { NotFoundError } from "../../errors/notFoundError";
import { ENVIRONMENTS } from "../../lib/envValues";
import { audit } from "../audit";
import { pluginKey } from "../compiler/subjects";
import { InUseError } from "../references/service";
import { IntegrationsInUseError, pluginIntegrationUsers } from "./integrationUsage";
import { getPluginRow } from "./repository";
import { assertCreator, type Caller } from "./service";
import { pluginTriggerUsers, TriggersInUseError } from "./triggerUsage";
import { pluginUsage } from "./usage";
import { syncPluginVariants } from "./variants";

/**
 * Removes a plugin (#860). Refused while a working copy or a promoted version
 * uses any of its blocks, the same rule as deleting a custom block, and while
 * an integration or a trigger of one of its kinds exists (I6, T2): those rows
 * would point at a kind nothing provides. Then the
 * row, its URL requests, both environments' artifacts and its tarballs go;
 * workers see the artifact go and stop serving it.
 */
export async function removePlugin(projectId: string, name: string, caller: Caller) {
	assertCreator(caller, projectId);
	const row = await getPluginRow(projectId, name);
	if (!row) throw new NotFoundError(`Plugin ${name} is not installed in this project`);
	const usage = await pluginUsage(projectId, name);
	if (usage.length) throw new InUseError("plugin", usage);
	// the pending version's kinds too: an integration may already use one an upgrade adds
	const integrations = await pluginIntegrationUsers(projectId, row.manifest, row.live?.manifest);
	if (integrations.length) throw new IntegrationsInUseError(name, integrations);
	const triggers = await pluginTriggerUsers(projectId, name);
	if (triggers.length) throw new TriggersInUseError(name, triggers);

	await db.transaction(async (tx) => {
		await tx
			.delete(pluginUrlRequestsEntity)
			.where(
				and(
					eq(pluginUrlRequestsEntity.projectId, projectId),
					eq(pluginUrlRequestsEntity.pluginName, name),
				),
			);
		await tx.delete(pluginsEntity).where(eq(pluginsEntity.id, row.id));
		await audit.record({
			projectId,
			resourceType: "plugin",
			resourceId: row.id,
			action: "delete",
			changedFields: [],
		});
	});
	await Promise.all(ENVIRONMENTS.map((env) => deleteArtifact(pluginKey(projectId, name), env)));
	// every version ever uploaded or fetched: `pluginObjectKey` puts them under this prefix
	const objects = await pluginObjects();
	for (const key of await objects.keys(`${projectId}/${name}/`)) await objects.delete(key);
	await syncPluginVariants(projectId, name);
	return { name };
}
