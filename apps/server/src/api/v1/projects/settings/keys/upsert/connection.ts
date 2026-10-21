import { integrationRegistry } from "@fluxify/adapters/integrations";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../../../../db";
import { integrationsEntity } from "../../../../../../db/schema";
import type { ProjectSettingsKeyType } from "../keySchemaMap";

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
						inArray(integrationsEntity.variant, integrationRegistry.names("ai")),
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
						// aliases included: a row created before a rename is still a valid destination
						inArray(integrationsEntity.variant, integrationRegistry.names("observability")),
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
