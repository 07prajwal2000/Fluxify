import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { TraceMetadata } from "@/services/recordings";
import { type SuiteTarget, testSuitesService } from "@/services/testSuites";

const linkClass = "text-accent hover:underline";

/**
 * A test trace's way back to the test run that made it (#627). A deleted test
 * run keeps its traces until they expire, so then it only says so.
 */
export function FromTestLink({
	projectId,
	target,
	metadata,
}: {
	projectId: string;
	target: SuiteTarget;
	metadata: TraceMetadata;
}) {
	const testRun = useQuery({
		queryKey: ["test-trace-origin", projectId, target.type, target.id, metadata.testRunId],
		queryFn: () => testSuitesService.getRun(projectId, target, metadata.testRunId),
		retry: false,
		refetchOnWindowFocus: false,
		staleTime: Number.POSITIVE_INFINITY,
	});
	const text = `From test: ${metadata.suiteName} · ${metadata.caseName}`;

	if (testRun.isError) return <span>{text} (the test run was deleted)</span>;
	const search = { runId: metadata.testRunId };
	return target.type === "route" ? (
		<Link
			to="/$projectId/canvas/$routeId/test-suites"
			params={{ projectId, routeId: target.id }}
			search={search}
			className={linkClass}
		>
			{text}
		</Link>
	) : (
		<Link
			to="/$projectId/workflow-canvas/$workflowId/test-suites"
			params={{ projectId, workflowId: target.id }}
			search={search}
			className={linkClass}
		>
			{text}
		</Link>
	);
}
