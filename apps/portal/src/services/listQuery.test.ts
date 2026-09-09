import { describe, expect, it, mock } from "bun:test";
import { listQuerySchema as workflowListQuery } from "@fluxify/server/src/api/v1/workflows/dto";
import { listQuerySchema as triggerListQuery } from "@fluxify/server/src/api/v1/triggers/dto";

/**
 * A list request the server refuses is not a visible failure — react-query
 * retries, so the UI sits on a spinner and then renders an empty list, which
 * reads as "there is nothing here" rather than "that request was invalid".
 * These check the query strings we actually build against the schemas that
 * actually validate them; `perPage` has a ceiling of 50 and asking for more is
 * a 400.
 */
const captured: string[] = [];
mock.module("@/lib/http", () => ({
	httpClient: {
		get: async (url: string) => {
			captured.push(url);
			return { data: { data: [], pagination: {} } };
		},
	},
}));

const { workflowsService } = await import("./workflows");
const { triggersService } = await import("./triggers");

const queryOf = (url: string) =>
	Object.fromEntries(new URLSearchParams(url.split("?")[1] ?? ""));

const PROJECT_ID = "0192f8b0-0000-7000-8000-000000000000";

describe("the list requests the portal sends", () => {
	it("asks for workflows within what the endpoint accepts", async () => {
		captured.length = 0;
		await workflowsService.getAll({ projectId: PROJECT_ID, perPage: 50 });
		expect(workflowListQuery.safeParse(queryOf(captured[0]!)).success).toBe(true);
	});

	it("asks for triggers within what the endpoint accepts", async () => {
		captured.length = 0;
		await triggersService.getAll({ projectId: PROJECT_ID, workflowId: PROJECT_ID });
		expect(triggerListQuery.safeParse(queryOf(captured[0]!)).success).toBe(true);
	});

	it("would have caught the oversized page that broke the workflow picker", () => {
		const parsed = workflowListQuery.safeParse({
			projectId: PROJECT_ID,
			page: "1",
			perPage: "100",
		});
		expect(parsed.success).toBe(false);
	});
});
