import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../../../../db";
import { integrationsEntity } from "../../../../../../db/schema";
import { ProjectSettingsKeyType } from "../keySchemaMap";
import { getIntegrationsVariants } from "../../../../integrations/helpers";
import { observabilityLegacyVariants } from "../../../../integrations/schemas";

export async function testConnectionFn(
	key: ProjectSettingsKeyType,
	value: string,
): Promise<{ success: boolean; message: string }> {
	switch (key) {
		case "settings.ai.agentConnectionId": {
			const result = await db
				.select({ id: integrationsEntity.id })
				.from(integrationsEntity)
				.where(
					and(
						eq(integrationsEntity.id, value),
						inArray(integrationsEntity.variant, getIntegrationsVariants("ai")),
					),
				);
			if (result.length === 0) {
				return { success: false, message: "Invalid connection ID" };
			}
			break;
		}
		case "settings.ai.loggerConnectionId":
		case "settings.telemetry.logsConnectionId":
		case "settings.telemetry.tracesConnectionId":
		case "settings.telemetry.metricsConnectionId": {
			const result = await db
				.select({ id: integrationsEntity.id })
				.from(integrationsEntity)
				.where(
					and(
						eq(integrationsEntity.id, value),
						inArray(integrationsEntity.variant, [
							...getIntegrationsVariants("observability"),
							// a row created before the rename is still a valid destination
							...observabilityLegacyVariants,
						]),
					),
				);
			if (result.length === 0) {
				return { success: false, message: "Invalid connection ID" };
			}
			break;
		}
		default: {
			break;
		}
	}
	return { success: true, message: "" };
}
