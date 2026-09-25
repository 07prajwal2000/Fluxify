import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { parentTable } from "../canvas/repository";

/**
 * What a suite tests (#487): a route or a workflow. Both are canvas parents, so
 * the graph, the hooks' blocks and the project all resolve the same way.
 */
export const suiteTargetTypeSchema = z.enum(["route", "workflow"]);
export type SuiteTarget = { type: z.infer<typeof suiteTargetTypeSchema>; id: string };

/** the path params every target-scoped endpoint carries */
export const targetParamSchema = z.object({
	kind: suiteTargetTypeSchema,
	targetId: z.string(),
});

export const targetFromParams = ({ kind, targetId }: z.infer<typeof targetParamSchema>) =>
	({ type: kind, id: targetId }) satisfies SuiteTarget;

/** the column of `test_suites` / `test_runs` / `test_suite_runs` holding this target */
export function targetColumn<R, W>(
	table: { routeId: R; workflowId: W },
	type: SuiteTarget["type"],
): R | W {
	return type === "route" ? table.routeId : table.workflowId;
}

/** the row values that point at `target`; the other kind is null */
export function targetKeys(target: SuiteTarget) {
	return {
		routeId: target.type === "route" ? target.id : null,
		workflowId: target.type === "workflow" ? target.id : null,
	};
}

/** read a row's target back; the check constraint guarantees exactly one is set */
export function targetOf(row: { routeId: string | null; workflowId: string | null }): SuiteTarget {
	return row.routeId
		? { type: "route", id: row.routeId }
		: { type: "workflow", id: row.workflowId! };
}

/** the target's project, or undefined when it does not exist */
export async function targetProject(target: SuiteTarget) {
	const table = parentTable(target.type);
	const [row] = await db
		.select({ projectId: table.projectId })
		.from(table)
		.where(eq(table.id, target.id));
	return row ? ((row.projectId as string | null) ?? undefined) : undefined;
}
