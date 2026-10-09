import { keepPreviousData, useQueries } from "@tanstack/react-query";
import type { RefType } from "@/components/ai/agentRefs";
import { findResourceQuery } from "@/query/findResourceQuery";
import { middlewaresService } from "@/services/middlewares";
import { testSuitesService } from "@/services/testSuites";
import { triggersService } from "@/services/triggers";
import { workflowsService } from "@/services/workflows";

/** A resource the @ picker offers. `label` is a custom block's own name, `variant` an integration's provider. */
export type Mention = {
	type: RefType;
	id: string;
	name: string;
	label?: string;
	description?: string;
	variant?: string;
};

const PER_TYPE = 10;
const has = (text: string | null | undefined, term: string) =>
	(text ?? "").toLowerCase().includes(term.toLowerCase());

/**
 * What the @ picker lists for `term`: routes, integrations, app config and custom
 * blocks from the project search, plus workflows, triggers, middlewares and test
 * suites from their own list endpoints. An empty term asks nothing.
 */
export function useResourceSearch(projectId: string, term: string) {
	const q = term.trim();
	const base = findResourceQuery.search.useQuery(projectId, q);
	const on = Boolean(projectId) && q.length > 0;
	const opts = {
		enabled: on,
		staleTime: 30_000,
		refetchOnWindowFocus: false,
		placeholderData: keepPreviousData,
	};
	const extra = useQueries({
		queries: [
			{
				...opts,
				queryKey: ["mention", projectId, "workflow", q],
				queryFn: async (): Promise<Mention[]> =>
					(await workflowsService.getAll({ projectId, search: q, perPage: PER_TYPE })).data.map(
						(w) => ({
							type: "workflow",
							id: w.id,
							name: w.name ?? w.id,
							description: w.description ?? undefined,
						}),
					),
			},
			{
				...opts,
				queryKey: ["mention", projectId, "trigger", q],
				queryFn: async (): Promise<Mention[]> =>
					(await triggersService.getAll({ projectId, search: q, perPage: PER_TYPE })).data.map(
						(t) => ({
							type: "trigger",
							id: t.id,
							name: t.name,
							description: t.description ?? undefined,
						}),
					),
			},
			{
				...opts,
				queryKey: ["mention", projectId, "middleware", q],
				queryFn: async (): Promise<Mention[]> =>
					(await middlewaresService.getAll(projectId))
						.filter((m) => has(m.name, q))
						.slice(0, PER_TYPE)
						.map((m) => ({
							type: "middleware",
							id: m.id,
							name: m.name,
							description: m.description ?? undefined,
						})),
			},
			{
				...opts,
				queryKey: ["mention", projectId, "test_suite", q],
				queryFn: async (): Promise<Mention[]> =>
					(await testSuitesService.listByProject(projectId))
						.filter((s) => has(s.name, q))
						.slice(0, PER_TYPE)
						.map((s) => ({
							type: "test_suite",
							id: s.id,
							name: s.name,
							description: s.targetName ? `Tests ${s.targetName}` : (s.description ?? undefined),
						})),
			},
		],
	});
	const found = (base.data?.results ?? []) as Mention[];
	return {
		results: on ? [...found, ...extra.flatMap((e) => e.data ?? [])] : [],
		isLoading: on && (base.isLoading || extra.some((e) => e.isLoading)),
		isFetching: on && (base.isFetching || extra.some((e) => e.isFetching)),
	};
}
