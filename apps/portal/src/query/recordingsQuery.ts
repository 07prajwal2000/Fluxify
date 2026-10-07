import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { showErrorNotification } from "@/lib/errorNotifier";
import { type RecordingTarget, recordingsService } from "@/services/recordings";
import { routesService } from "@/services/routes";
import { systemLogsService } from "@/services/systemLogs";
import { workflowsService } from "@/services/workflows";
import { routesQuery } from "./routesQuery";
import { workflowsQuery } from "./workflowsQuery";

const runsKey = (projectId: string, target: RecordingTarget) => [
	"recordings",
	projectId,
	target.type,
	target.id,
];

/** how often the run list is re-read while someone is looking at it */
const LIST_POLL_MS = 2000;
// ponytail: fixed wait like the canvas save; past it the toggle just stops spinning
const COMPILE_WAIT_MS = 30_000;

/** when the target's compile log was last written (server clock), 0 if never */
async function compiledAt(projectId: string, target: RecordingTarget) {
	const [log] = await systemLogsService.list(projectId, {
		type: "compile",
		resourceType: target.type,
		resourceId: target.id,
		limit: 1,
	});
	return Date.parse(log?.updatedAt ?? "") || 0;
}

export const recordingsQuery = {
	getRuns: {
		/** `poll` only while the list is on screen: closing it stops the timer */
		useQuery(
			projectId: string,
			target: RecordingTarget,
			page: number,
			poll: boolean,
			outcome?: "success" | "failure",
		) {
			return useQuery({
				queryKey: [...runsKey(projectId, target), "list", page, outcome ?? "all"],
				queryFn: () => recordingsService.getRuns(projectId, target, { page, outcome }),
				enabled: !!projectId && !!target.id,
				refetchOnWindowFocus: false,
				refetchInterval: () => {
					if (!poll) return false;
					if (typeof document !== "undefined" && document.hidden) return false;
					return LIST_POLL_MS;
				},
			});
		},
	},
	getRun: {
		useQuery(projectId: string, target: RecordingTarget, runId: string | null) {
			return useQuery({
				queryKey: [...runsKey(projectId, target), "detail", runId],
				queryFn: () => {
					if (!runId) throw new Error("runId is required");
					return recordingsService.getRun(projectId, target, runId);
				},
				enabled: !!runId,
				refetchOnWindowFocus: false,
				// a finished run never changes
				staleTime: Number.POSITIVE_INFINITY,
			});
		},
	},
	deleteRun: {
		useMutation(projectId: string, target: RecordingTarget) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (runId: string) => recordingsService.deleteRun(projectId, target, runId),
				onSuccess: (_data, runId) => {
					qc.removeQueries({ queryKey: [...runsKey(projectId, target), "detail", runId] });
					return qc.invalidateQueries({ queryKey: [...runsKey(projectId, target), "list"] });
				},
			});
		},
	},
	clearRuns: {
		useMutation(projectId: string, target: RecordingTarget) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: () => recordingsService.clearRuns(projectId, target),
				onSuccess: () => {
					qc.removeQueries({ queryKey: [...runsKey(projectId, target), "detail"] });
					return qc.invalidateQueries({ queryKey: [...runsKey(projectId, target), "list"] });
				},
			});
		},
	},
};

/**
 * The target's `recordExecution` flag. Changing it recompiles the target, so
 * `isApplying` holds until the new compile has landed (or the wait runs out) —
 * the switch shows the server's value, never an optimistic flip.
 */
export function useRecordingSwitch(projectId: string, target: RecordingTarget) {
	const qc = useQueryClient();
	const route = routesQuery.byId.useQuery(target.type === "route" ? target.id : "");
	const workflow = workflowsQuery.byId.useQuery(target.type === "workflow" ? target.id : "");
	const data = target.type === "route" ? route.data : workflow.data;

	const set = useMutation({
		mutationFn: async (recordExecution: boolean) => {
			const before = await compiledAt(projectId, target).catch(() => 0);
			if (target.type === "route") {
				await routesService.updatePartial(target.id, { recordExecution });
			} else {
				await workflowsService.update(target.id, { recordExecution });
			}

			const typeKey = target.type === "route" ? "routes" : "workflows";
			qc.setQueriesData<{ data?: Array<{ id: string; recordExecution?: boolean }> }>(
				{ queryKey: [typeKey, "list"] },
				(old) => {
					if (!old || !Array.isArray(old.data)) return old;
					return {
						...old,
						data: old.data.map((item) =>
							item.id === target.id ? { ...item, recordExecution } : item,
						),
					};
				},
			);
			qc.setQueriesData<{ recordExecution?: boolean }>(
				{ queryKey: [typeKey, target.id, "by-id"] },
				(old) => (old ? { ...old, recordExecution } : old),
			);
			qc.invalidateQueries({ queryKey: [typeKey, target.id, "by-id"] });
			qc.invalidateQueries({ queryKey: [typeKey, "list"] });

			for (const deadline = Date.now() + COMPILE_WAIT_MS; Date.now() < deadline; ) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				if ((await compiledAt(projectId, target).catch(() => 0)) > before) break;
			}
		},
		onError: (error) => showErrorNotification(error),
		onSettled: () => {
			const typeKey = target.type === "route" ? "routes" : "workflows";
			qc.invalidateQueries({
				queryKey: [typeKey, target.id, "by-id"],
			});
			qc.invalidateQueries({
				queryKey: [typeKey, "list"],
			});
		},
	});

	return {
		isOn: Boolean(data?.recordExecution),
		isLoading: !data,
		isApplying: set.isPending,
		set: set.mutate,
	};
}
