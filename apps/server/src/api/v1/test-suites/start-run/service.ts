import { CustomError } from "../../../../errors/customError";
import { ForbiddenError } from "../../../../errors/forbidError";
import { NotFoundError } from "../../../../errors/notFoundError";
import { ServerError } from "../../../../errors/serverError";
import {
	startTestRun,
	TestRunError,
} from "../../../../modules/testRunner/runner";

export default async function handleRequest(input: {
	projectId: string;
	routeId: string;
	suiteIds?: string[];
}) {
	try {
		// `done` is deliberately not awaited: the response is the run id, and the
		// suites report progress by updating their own rows. It never rejects —
		// executeRun catches everything — but a stray handler costs nothing.
		const { runId, done } = await startTestRun(input);
		done.catch(() => {});
		return { runId };
	} catch (err: unknown) {
		if (err instanceof TestRunError) {
			throw err.status === 403
				? new ForbiddenError(err.message)
				: new NotFoundError(err.message);
		}
		if (err instanceof CustomError) throw err;
		throw new ServerError(
			err instanceof Error ? err.message : "Failed to start test run",
		);
	}
}
