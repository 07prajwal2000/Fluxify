import { BlockTypes } from "@fluxify/blocks";
import { assertCanUse } from "../../lib/edition";
import { queueIntegrationsCache } from "../../loaders/integrationsLoader";
import { isEnterpriseTriggerType } from "../triggers/types";
import type { CanvasChanges } from "./types";

/**
 * A Send Message block aimed at an enterprise connector (Kafka, NATS, SQS) needs
 * the same license as a trigger on one, refused with the same error.
 *
 * Only blocks this save adds or changes are checked: a block saved under a
 * license keeps sending after it lapses (§14.2), and an unrelated edit on the
 * same canvas must not start failing because of it.
 */
export function assertSendMessageLicensed(data: CanvasChanges) {
	for (const block of data.changes.blocks) {
		if (block.type !== BlockTypes.queue_send) continue;
		const connection = (block.data as { connection?: unknown })?.connection;
		const variant = typeof connection === "string" && queueIntegrationsCache[connection]?.variant;
		if (typeof variant === "string" && isEnterpriseTriggerType(variant.toLowerCase())) {
			assertCanUse("connectors");
			return;
		}
	}
}
