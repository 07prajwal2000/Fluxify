import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../../../../../db";
import { integrationsEntity } from "../../../../../../db/schema";
import { ProjectSettingsKeyType } from "../keySchemaMap";
import { getIntegrationsVariants } from "../../../../integrations/helpers";

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
    default: {
      break;
    }
  }
  return { success: true, message: "" };
}
