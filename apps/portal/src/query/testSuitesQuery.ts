import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
	IN_FLIGHT_STATUSES,
	type CreateTestSuiteBody,
	type UpdateTestSuiteBody,
	testSuitesService,
} from "@/services/testSuites";

const suiteKey = (routeId: string) => ["test-suites", routeId];
const runKey = (projectId: string, routeId: string) => [
	"test-runs",
	projectId,
	routeId,
];

/** how often an unfinished run is re-read */
const RUN_POLL_MS = 1_500;

export const testSuitesQuery = {
	getAll: {
		useQuery(routeId: string | null | undefined) {
			return useQuery({
				queryKey: suiteKey(routeId!),
				queryFn: () => testSuitesService.getAll(routeId!),
				enabled: !!routeId,
				refetchOnWindowFocus: false,
			});
		},
	},
	getById: {
		useQuery(routeId: string, id: string | null | undefined) {
			return useQuery({
				queryKey: [...suiteKey(routeId), "detail", id],
				queryFn: () => testSuitesService.getById(id!),
				enabled: !!id,
				refetchOnWindowFocus: false,
			});
		},
	},
	create: {
		mutation(routeId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: CreateTestSuiteBody) =>
					testSuitesService.create(routeId, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: suiteKey(routeId) }),
			});
		},
	},
	update: {
		mutation(routeId: string, id: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (body: UpdateTestSuiteBody) =>
					testSuitesService.update(id, body),
				onSuccess: () => qc.invalidateQueries({ queryKey: suiteKey(routeId) }),
			});
		},
	},
	remove: {
		mutation(routeId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (id: string) => testSuitesService.delete(id),
				onSuccess: () => qc.invalidateQueries({ queryKey: suiteKey(routeId) }),
			});
		},
	},

	startRun: {
		mutation(projectId: string, routeId: string) {
			const qc = useQueryClient();
			return useMutation({
				mutationFn: (suiteIds?: string[]) =>
					testSuitesService.startRun(projectId, routeId, suiteIds),
				onSuccess: () =>
					qc.invalidateQueries({ queryKey: runKey(projectId, routeId) }),
			});
		},
	},
	getRuns: {
		useQuery(
			projectId: string,
			routeId: string,
			query: { page?: number; perPage?: number } = {},
		) {
			return useQuery({
				queryKey: [...runKey(projectId, routeId), query],
				queryFn: () => testSuitesService.getRuns(projectId, routeId, query),
				enabled: !!projectId && !!routeId,
				refetchOnWindowFocus: false,
			});
		},
	},
	getRun: {
		useQuery(
			projectId: string,
			routeId: string,
			runId: string | null | undefined,
		) {
			return useQuery({
				queryKey: [...runKey(projectId, routeId), "detail", runId],
				queryFn: () => testSuitesService.getRun(projectId, routeId, runId!),
				enabled: !!runId,
				refetchOnWindowFocus: false,
				// a settled run never changes again, so polling stops with it —
				// otherwise every visited run keeps a timer alive forever
				refetchInterval: (query) =>
					query.state.data &&
					!IN_FLIGHT_STATUSES.includes(query.state.data.status)
						? false
						: RUN_POLL_MS,
			});
		},
	},
};
