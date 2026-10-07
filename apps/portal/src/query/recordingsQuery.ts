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
		useQuery(projectId: string, target: RecordingTarget, page: number, poll: boolean) {
			return useQuery({
				queryKey: [...runsKey(projectId, target), "list", page],
				queryFn: () => recordingsService.getRuns(projectId, target, { page }),
				enabled: !!projectId && !!target.id,
				refetchOnWindowFocus: false,
				refetchInterval: poll ? LIST_POLL_MS : false,
			});
		},
	},
	getRun: {
		useQuery(projectId: string, target: RecordingTarget, runId: string | null) {
			return useQuery({
				queryKey: [...runsKey(projectId, target), "detail", runId],
				queryFn: () => recordingsService.getRun(projectId, target, runId!),
				enabled: !!runId,
				refetchOnWindowFocus: false,
				// a finished run never changes
				staleTime: Number.POSITIVE_INFINITY,
			});
		},
	},
	deleteRun: {
		mutation(projectId: string, target: RecordingTarget) {
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
		mutation(projectId: string, target: RecordingTarget) {
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
			for (const deadline = Date.now() + COMPILE_WAIT_MS; Date.now() < deadline; ) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				if ((await compiledAt(projectId, target).catch(() => 0)) > before) break;
			}
		},
		onError: (error) => showErrorNotification(error),
		onSettled: () =>
			qc.invalidateQueries({
				queryKey: [target.type === "route" ? "routes" : "workflows", target.id, "by-id"],
			}),
	});

	return {
		isOn: Boolean(data?.recordExecution),
		isLoading: !data,
		isApplying: set.isPending,
		set: set.mutate,
	};
}
