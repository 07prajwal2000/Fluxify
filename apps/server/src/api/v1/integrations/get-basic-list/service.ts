import { getBasicListRepository } from "./repository";

export default async function handleRequest(projectId: string) {
	const results = await getBasicListRepository(projectId);

	return results.map((result) => ({
		id: result.id,
		name: result.name || "",
		group: result.group || "",
		variant: result.variant || "",
	}));
}
