import { z } from "zod";
import { requestQuerySchema } from "./dto";
import { getTestRuns } from "./repository";

export default async function handleRequest(
	projectId: string,
	routeId: string,
	query: z.infer<typeof requestQuerySchema>,
) {
	const { page, perPage } = query;
	const { result, totalCount } = await getTestRuns(
		projectId,
		routeId,
		(page - 1) * perPage,
		perPage,
	);
	const totalPages = Math.ceil(totalCount / perPage);
	return {
		data: result,
		pagination: { page, totalPages, hasNext: page < totalPages },
	};
}
