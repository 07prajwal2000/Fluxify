import { integrationRegistry } from "@fluxify/adapters/integrations";
import type { z } from "zod";
import { BadRequestError } from "../../../../errors/badRequestError";
import { redactOAuth } from "../mcp-oauth/store";
import type { responseSchema } from "./dto";
import { getAllIntegrationsByGroup } from "./repository";

export default async function handleRequest(
	projectId: string,
	group: string,
	tags?: string,
): Promise<z.infer<typeof responseSchema>> {
	if (!integrationRegistry.hasGroup(group, projectId)) {
		throw new BadRequestError(`Unknown integration group "${group}"`);
	}
	const tagsArray = tags
		? tags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
		: undefined;
	const result = await getAllIntegrationsByGroup(projectId, group, tagsArray);
	return result.map((item) => ({
		id: item.id,
		name: item.name ?? "",
		group: item.group ?? "",
		variant: item.variant ?? "",
		config: redactOAuth(item.config) as any,
		devConfig: (redactOAuth(item.devConfig) as any) ?? null,
		syncDev: item.syncDev,
		tags: item.tags ? item.tags.split(",") : undefined,
		// static per variant, so it never waits on the database being reachable
		conditionEditor:
			item.group === "database" && item.variant
				? integrationRegistry.get("database", item.variant, projectId)?.extras.conditionEditor
				: undefined,
	}));
}
