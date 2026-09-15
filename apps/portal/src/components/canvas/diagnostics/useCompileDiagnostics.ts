import { useCallback, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { systemLogsService, type SystemLog } from "@/services/systemLogs";
import { COMPILE_SOURCE, compileDiagnostics } from "./compileDiagnostics";
import { useBlockDiagnostics } from "./DiagnosticsContext";

export type CompileTarget = {
	projectId: string;
	resourceType: "route" | "workflow" | "custom_block";
	resourceId: string;
};

const POLL_MS = 1000;
// ponytail: fixed wait; a push channel replaces the polling if 30s proves short
const TIMEOUT_MS = 30_000;

/**
 * Surfaces the latest compile result of a canvas as diagnostics, loaded with the
 * canvas and cached by react-query; a save takes a baseline
 * first, then waits for the compile log to be rewritten after it.
 */
export function useCompileDiagnostics(
	target: CompileTarget,
	blocks: { id: string; type: string }[],
) {
	const qc = useQueryClient();
	const { setFromSource, registerValidator } = useBlockDiagnostics();
	const { projectId, resourceType, resourceId } = target;

	const queryKey = useMemo(
		() => ["system-logs", projectId, "compile", resourceType, resourceId],
		[projectId, resourceType, resourceId],
	);
	const fetchLatest = useCallback(
		async (): Promise<SystemLog | null> =>
			(
				await systemLogsService.list(projectId, {
					type: "compile",
					resourceType,
					resourceId,
					limit: 1,
				})
			)[0] ?? null,
		[projectId, resourceType, resourceId],
	);
	const refetch = useCallback(
		() => qc.fetchQuery({ queryKey, queryFn: fetchLatest, staleTime: 0 }),
		[qc, queryKey, fetchLatest],
	);

	const { data } = useQuery({
		queryKey,
		queryFn: fetchLatest,
		refetchOnWindowFocus: false,
	});

	// while a save waits, the "compiling" note must not be replaced by the old result
	const waiting = useRef(false);
	const current = useRef<() => ReturnType<typeof compileDiagnostics>>(() => []);
	current.current = () => compileDiagnostics(data ?? undefined, blocks);

	useEffect(() => {
		if (!waiting.current) setFromSource(COMPILE_SOURCE, current.current());
	}, [data, blocks, setFromSource]);

	// "Revalidate" replaces every diagnostic with what validators return
	useEffect(() => registerValidator(COMPILE_SOURCE, () => current.current()), [registerValidator]);

	/** call before saving: when the log was last written (server clock), 0 if never */
	const baseline = useCallback(
		async () => Date.parse((await refetch().catch(() => null))?.updatedAt ?? "") || 0,
		[refetch],
	);

	/** call after a successful save; undefined when no result arrived in time */
	const waitForCompile = useCallback(
		async (after: number): Promise<SystemLog | undefined> => {
			waiting.current = true;
			setFromSource(COMPILE_SOURCE, [
				{ severity: "info", message: "Compiling the saved canvas…", source: COMPILE_SOURCE, pending: true },
			]);
			try {
				await qc.invalidateQueries({ queryKey });
				for (const deadline = Date.now() + TIMEOUT_MS; Date.now() < deadline; ) {
					await new Promise((resolve) => setTimeout(resolve, POLL_MS));
					const latest = await refetch().catch(() => null);
					if (latest && Date.parse(latest.updatedAt) > after) {
						setFromSource(COMPILE_SOURCE, compileDiagnostics(latest, blocks));
						return latest;
					}
				}
				setFromSource(COMPILE_SOURCE, [
					{
						severity: "warning",
						message: "No compile result yet. Open diagnostics again in a moment.",
						source: COMPILE_SOURCE,
					},
				]);
				return undefined;
			} finally {
				waiting.current = false;
			}
		},
		[qc, queryKey, refetch, setFromSource, blocks],
	);

	return { baseline, waitForCompile };
}
