import type { z } from "zod";
import type { requestQuerySchema } from "./dto";
import { getRecordedRuns, type RunTarget } from "./repository";

export const withDuration = <R extends { startedAt: Date; endedAt: Date | null }>(run: R) => ({
	...run,
	durationMs: run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null,
});

export default async function handleRequest(
	projectId: string,
	target: RunTarget,
	query: z.infer<typeof requestQuerySchema>,
) {
	const { page, perPage } = query;
	const { result, totalCount } = await getRecordedRuns(
		projectId,
		target,
		query,
		(page - 1) * perPage,
		perPage,
	);
	const totalPages = Math.ceil(totalCount / perPage);
	return {
		data: result.map(withDuration),
		pagination: { page, totalPages, hasNext: page < totalPages },
	};
}
