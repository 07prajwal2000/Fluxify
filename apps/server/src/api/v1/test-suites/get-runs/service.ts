import type { z } from "zod";
import type { SuiteTarget } from "../../../../modules/testRunner/target";
import type { requestQuerySchema } from "./dto";
import { getTestRuns } from "./repository";

export default async function handleRequest(
	projectId: string,
	target: SuiteTarget,
	query: z.infer<typeof requestQuerySchema>,
) {
	const { page, perPage, suiteId } = query;
	const { result, totalCount } = await getTestRuns(
		projectId,
		target,
		(page - 1) * perPage,
		perPage,
		suiteId,
	);
	const totalPages = Math.ceil(totalCount / perPage);
	return {
		data: result,
		pagination: { page, totalPages, hasNext: page < totalPages },
	};
}
