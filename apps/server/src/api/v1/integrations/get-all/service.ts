import { z } from "zod";
import { responseSchema } from "./dto";
import { getAllIntegrationsByGroup } from "./repository";

export default async function handleRequest(
	group: string,
	tags?: string,
): Promise<z.infer<typeof responseSchema>> {
	const tagsArray = tags
		? tags
				.split(",")
				.map((t) => t.trim())
				.filter(Boolean)
		: undefined;
	const result = await getAllIntegrationsByGroup(group, tagsArray);
	return result.map((item) => ({
		id: item.id,
		name: item.name!,
		group: item.group!,
		variant: item.variant!,
		config: item.config as any,
		tags: item.tags ? item.tags.split(",") : undefined,
	}));
}
