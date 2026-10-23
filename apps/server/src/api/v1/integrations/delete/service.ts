import { db } from "../../../../db";
import { CHAN_ON_INTEGRATION_CHANGE, publishMessage } from "../../../../db/redis";
import { NotFoundError } from "../../../../errors/notFoundError";
import { audit } from "../../../../modules/audit";
import { pluginTriggersUsing } from "../../triggers/pluginTriggers";
import { findIntegration, findTriggersByIntegration } from "../../triggers/repository";
import { disableTrigger, withdraw } from "../../triggers/service";
import { deleteIntegration } from "./repository";

export default async function handleRequest(projectId: string, id: string) {
	// The foreign key deletes the triggers' rows, but not their artifacts: read
	// them first, or their consumers keep running on credentials that are gone.
	// A plugin trigger names the integration in a param instead: it is kept, off.
	const { triggers, pluginTriggers, name } = await db.transaction(async (tx) => {
		const using = await findTriggersByIntegration(id, tx);
		const integration = await findIntegration(id, tx);
		const plugin = await pluginTriggersUsing(projectId, id, tx);
		if ((await deleteIntegration(projectId, id, tx)) === 0) {
			throw new NotFoundError("Integration not found");
		}
		await audit.record({
			projectId,
			resourceType: "integration",
			resourceId: id,
			action: "delete",
			changedFields: [],
		});
		return { triggers: using, pluginTriggers: plugin, name: integration?.name ?? id };
	});
	for (const trigger of triggers) await withdraw(trigger.projectId, trigger.id);
	for (const triggerId of pluginTriggers)
		await disableTrigger(triggerId, projectId, `integration "${name}" was deleted`);
	await publishMessage(CHAN_ON_INTEGRATION_CHANGE, "");
}
