import { getBasicListRepository } from "./repository";

export default async function handleRequest(
	projectId: string,
	useForHarness?: boolean,
) {
	const results = await getBasicListRepository(projectId, useForHarness);

	return results.map((result) => ({
		id: result.id,
		name: result.name || "",
		group: result.group || "",
		variant: result.variant || "",
	}));
}
