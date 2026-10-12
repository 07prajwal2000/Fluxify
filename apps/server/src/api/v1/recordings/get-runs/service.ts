import type { z } from "zod";
import type { FluxifyEnv } from "../../../../lib/env";
import type { requestQuerySchema } from "./dto";
import { getRecordedRuns, type RunTarget } from "./repository";

/**
 * A recorded run as API clients and agents read it (#782). The internal
 * `routeVersion` / `workflowVersion` never leave here; instead it carries the two
 * plain fields: `graph` (the version's `vN`, or "working copy") and `values` (the
 * environment the run used). `versionNumber` is resolved from `versionId`.
 */
export const presentRun = <
	R extends {
		env: FluxifyEnv;
		versionNumber: number | null;
		startedAt: Date;
		endedAt: Date | null;
	},
>(
	run: R,
) => {
	const { env, ...rest } = run;
	return {
		...rest,
		durationMs: run.endedAt ? run.endedAt.getTime() - run.startedAt.getTime() : null,
		graph: run.versionNumber == null ? "working copy" : `v${run.versionNumber}`,
		values: env,
	};
};

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
		data: result.map(presentRun),
		pagination: { page, totalPages, hasNext: page < totalPages },
	};
}
