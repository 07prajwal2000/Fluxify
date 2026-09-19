import type { z } from "zod";
import { databaseConditionEditors, type databaseVariantSchema } from "../schemas";
import type { responseSchema } from "./dto";
import { getAllIntegrationsByGroup } from "./repository";

export default async function handleRequest(
	projectId: string,
	group: string,
	tags?: string,
): Promise<z.infer<typeof responseSchema>> {
	const tagsArray = tags
		? tags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
		: undefined;
	const result = await getAllIntegrationsByGroup(projectId, group, tagsArray);
	return result.map((item) => ({
		id: item.id,
		name: item.name!,
		group: item.group!,
		variant: item.variant!,
		config: item.config as any,
		tags: item.tags ? item.tags.split(",") : undefined,
		// static per variant, so it never waits on the database being reachable
		conditionEditor:
			item.group === "database"
				? databaseConditionEditors[item.variant as z.infer<typeof databaseVariantSchema>]
				: undefined,
	}));
}
