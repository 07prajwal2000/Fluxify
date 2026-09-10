import { db } from "../../../../db";
import {
  CHAN_ON_INTEGRATION_CHANGE,
  publishMessage,
} from "../../../../db/redis";
import { NotFoundError } from "../../../../errors/notFoundError";
import { findTriggersByIntegration } from "../../triggers/repository";
import { withdraw } from "../../triggers/service";
import { deleteIntegration } from "./repository";

export default async function handleRequest(projectId: string, id: string) {
  // The foreign key deletes the triggers' rows, but not their artifacts: read
  // them first, or their consumers keep running on credentials that are gone.
  const triggers = await db.transaction(async (tx) => {
    const using = await findTriggersByIntegration(id, tx);
    if ((await deleteIntegration(projectId, id, tx)) === 0) {
      throw new NotFoundError("Integration not found");
    }
    return using;
  });
  for (const trigger of triggers) await withdraw(trigger.projectId, trigger.id);
  await publishMessage(CHAN_ON_INTEGRATION_CHANGE, "");
}
