import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	type CreateTestSuiteBody,
	IN_FLIGHT_STATUSES,
	type SuiteTarget,
	testSuitesService,
	type UpdateTestSuiteBody,
} from "@/services/testSuites";

const suiteKey = (target: SuiteTarget) => ["test-suites", target.type, target.id];
const runKey = (projectId: string, target: SuiteTarget) => [
	"test-runs",
	projectId,
	target.type,
	target.id,
];

/**
 * How often an unfinished run is re-read. Suite rows land one at a time, so a
 * short interval is what makes them appear to fill in rather than arrive in
 * batches; the request is a single indexed read.
 */
const RUN_POLL_MS = 500;

export const testSuitesQuery = {
	getAll: {
		useQuery(target: SuiteTarget) {
			return useQuery({
				queryKey: suiteKey(target),
				queryFn: () => testSuitesService.getAll(target),
				enabled: !!target.id,
				refetchOnWindowFocus: false,
			});
		},
	},
	getById: {
		useQuery(target: SuiteTarget, id: string | null | undefined) {
			return useQuery({
				queryKey: [...suiteKey(target), "detail", id],
				queryFn: () => testSuitesService.getById(id!),
				enabled: !!id,
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation(target: SuiteTarget) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: CreateTestSuiteBody) => testSuitesService.create(target, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: suiteKey(target) }),
			});
		},
	},
	update: {
		mutation(target: SuiteTarget, id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: UpdateTestSuiteBody) => testSuitesService.update(id, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: suiteKey(target) }),
			});
		},
	},
	remove: {
		mutation(target: SuiteTarget) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => testSuitesService.delete(id),
				onSuccess: () => qc.invalidateQueries({ queryKey: suiteKey(target) }),
			});
		},
	},

	startRun: {
		mutation(projectId: string, target: SuiteTarget) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (suiteIds?: string[]) =>
					testSuitesService.startRun(projectId, target, suiteIds),
				onSuccess: () => qc.invalidateQueries({ queryKey: runKey(projectId, target) }),
			});
		},
	},
	getRuns: {
		useQuery(
			projectId: string,
			target: SuiteTarget,
			query: { page?: number; perPage?: number } = {},
		) {
			return useQuery({
				queryKey: [...runKey(projectId, target), query],
				queryFn: () => testSuitesService.getRuns(projectId, target, query),
				enabled: !!projectId && !!target.id,
				refetchOnWindowFocus: false,
			});
		},
	},
	clearRuns: {
		mutation(projectId: string, target: SuiteTarget) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: () => testSuitesService.clearRuns(projectId, target),
				onSuccess: () => qc.invalidateQueries({ queryKey: runKey(projectId, target) }),
			});
		},
	},
	getRun: {
		useQuery(projectId: string, target: SuiteTarget, runId: string | null | undefined) {
			return useQuery({
				queryKey: [...runKey(projectId, target), "detail", runId],
				queryFn: () => testSuitesService.getRun(projectId, target, runId!),
				enabled: !!runId,
				refetchOnWindowFocus: false,
				// a settled run never changes again, so polling stops with it —
				// otherwise every visited run keeps a timer alive forever
				refetchInterval: (query) =>
					query.state.data && !IN_FLIGHT_STATUSES.includes(query.state.data.status)
						? false
						: RUN_POLL_MS,
			});
		},
	},
};
