import { requestBodySchema as cloneBody } from "@fluxify/server/src/api/v1/test-suites/clone/dto";
import { requestBodySchema as suiteUpdate } from "@fluxify/server/src/api/v1/test-suites/update/dto";
import { z } from "zod";
import { hooksWithIds } from "./suiteHooks";
import type { McpTool } from "./tools";
import { optionalFields } from "./writeTools";

const SAVE = { readOnlyHint: false, destructiveHint: false };
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true };

const testSuiteId = z.string().describe("Test suite id, from list_test_suites");
const targetType = z.enum(["route", "workflow"]);

// projectId comes from the target; `params` is not read by the runner (routeParams is)
const { projectId: _p, params: _params, ...fields } = optionalFields(suiteUpdate.shape);

const DESCRIPTION = `Create or update a test suite for a route or a workflow. To create pass targetType ('route' or 'workflow'), targetId and name. On update pass testSuiteId and only what changes; a suite cannot move to another target (use clone_test_suite).
Route suite: one request. routeParams fills each :param of the path ({ id: '42' }), plus queryParams, headers, body (JSON by default; contentType for forms or files).
Workflow suite: input = { source: 'raw', mode: 'single' | 'cases', raw }. single: one run, raw is the trigger items (a list is several items). cases: one run per entry of raw, each entry { name, input } or a plain value; max 100. source 'script' runs script (JS that returns the value); 'loader' runs loaderBlockId (a test-only custom block).
assertions (all must pass): { target, operator, expectedValue, propertyPath }. expectedValue is a string. Route targets: status and time (eq, neq, lt, gt); body and header (eq, neq, contains, true, false, exists, not_exists), propertyPath is a body path 'user.tags[0]' or the header name. Workflow targets: successful (true, false); output (like body); time. eq compares as text, objects as compact JSON. target 'customJs' takes customJs code that calls t.expect(value).toBe(x) / toEqual / toContain / toHaveLength / toHaveProperty; it reads fluxify.response.{status,body,headers} (route) or fluxify.result.{successful,output,error} (workflow) and t.setup.
setupBlockId / teardownBlockId: custom blocks created with usage 'test', run before / after; setup's result is t.setup. Teardown also reads testsuite.request and testsuite.response (route: { status, headers, body } or null; workflow: { successful, output, error }; lists per case in cases mode), so it can delete by an id the response holds. t.runId is one value per suite run, the same for every case; add t.case.index for per-case data. hooks (replaces all of the suite's hooks): [{ blockId, onBefore?, onAfter? }] on blocks of the target's canvas (blockId is the block key from get_canvas, e.g. db_insert_1), each { kind: 'json', value: '<made-up output as JSON text>' } to skip the block, or { kind: 'script', value: 'return {...input, x: 1}' } (input, output, t.skip(output, branch?), t.fail(msg)). A json onBefore takes the first path of a two-path block (success). To take failure use t.skip(output, 'failure') on db_exists, queue_send or db_transaction; any other branch name is refused. if/switch/loops/retry allow only an onBefore script. appConfigOverrides [{ key, value }] and integrationOverrides [{ existingId, newId }] apply to this suite only.
Then run it with run_test_suite, or check the assertions against the last run first with validate_test_suite.`;

export const testSuiteTools: McpTool[] = [
	{
		name: "save_test_suite",
		title: "Save test suite",
		description: DESCRIPTION,
		role: "creator",
		annotations: SAVE,
		input: {
			testSuiteId: testSuiteId.optional().describe("Test suite id to update; omit to create"),
			targetType: targetType.optional().describe("Create only: what the suite tests"),
			targetId: z.string().optional().describe("Create only: the route or workflow id"),
			...fields,
		},
		call: async ({ get, send }, { testSuiteId: id, targetType: kind, targetId, ...a }) => {
			if (id) {
				if (a.hooks?.length) {
					const suite = await get(`/v1/test-suites/${id}`);
					const onRoute = Boolean(suite.routeId);
					a.hooks = await hooksWithIds(
						get,
						onRoute ? "route" : "workflow",
						suite.routeId ?? suite.workflowId,
						a.hooks,
					);
				}
				return { id: (await send("PUT", `/v1/test-suites/${id}`, a)).id };
			}
			if (!kind || !targetId || !a.name) {
				throw new Error("To create a test suite pass targetType, targetId and name.");
			}
			const { name, description, ...rest } = a;
			if (rest.hooks?.length) rest.hooks = await hooksWithIds(get, kind, targetId, rest.hooks);
			const created = await send("POST", `/v1/test-suites/${kind}/${targetId}`, {
				name,
				description: description ?? "",
			});
			if (!Object.keys(rest).length) return { id: created.id };
			try {
				await send("PUT", `/v1/test-suites/${created.id}`, rest);
			} catch (error) {
				// the server creates in two steps; don't leave a half-made suite behind
				await send("DELETE", `/v1/test-suites/${created.id}`).catch(() => {});
				throw error;
			}
			return { id: created.id };
		},
	},
	{
		name: "validate_test_suite",
		title: "Check test suite without running",
		description:
			"Check a suite's assertions against a response without running anything: the response of the suite's last run, or a sample you pass ({ status, headers, body } for a route, { output } for a workflow; leave a part out to skip its checks). Reports a body, output or header path the response does not have (with the keys it does have), a true/false check on a value that is not a boolean, and an expected value that is not a number for status or time. Custom JS is not looked at. source is null when the suite has no run with an answer yet: run it once with run_test_suite, or pass a sample.",
		role: "creator",
		input: {
			testSuiteId,
			sample: z
				.object({
					status: z.number().int().optional(),
					headers: z.record(z.string(), z.string()).optional(),
					body: z.unknown().optional(),
					output: z.unknown().optional(),
				})
				.optional()
				.describe("A response to check against instead of the last run"),
		},
		call: ({ send }, { testSuiteId: id, sample }) =>
			send("POST", `/v1/test-suites/${id}/validate`, sample ? { sample } : {}),
	},
	{
		name: "delete_test_suite",
		title: "Delete test suite",
		description: "Delete a test suite and its hooks. Its route or workflow stays.",
		role: "creator",
		annotations: DELETE,
		input: { testSuiteId },
		call: async ({ send }, a) => {
			await send("DELETE", `/v1/test-suites/${a.testSuiteId}`);
			return { deleted: a.testSuiteId };
		},
	},
	{
		name: "clone_test_suite",
		title: "Clone test suite",
		description:
			"Copy a test suite to a route or workflow of the same project (kind and targetId), named '<name> (copy)'. Checks, overrides, setup and teardown are copied; the request or input only when kind is the same. Hooks move to the block with the same type and name on the target; droppedHooks names the blocks that had no match.",
		role: "creator",
		annotations: SAVE,
		input: { testSuiteId, ...cloneBody.shape },
		call: async ({ send }, { testSuiteId: id, ...body }) => {
			const { id: newId, droppedHooks } = await send("POST", `/v1/test-suites/${id}/clone`, body);
			return { id: newId, droppedHooks };
		},
	},
];
