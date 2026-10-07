import { requestBodySchema as cloneBody } from "@fluxify/server/src/api/v1/test-suites/clone/dto";
import { requestBodySchema as suiteUpdate } from "@fluxify/server/src/api/v1/test-suites/update/dto";
import { z } from "zod";
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
setupBlockId / teardownBlockId: custom blocks created with usage 'test', run before / after; setup's result is t.setup. hooks (replaces all of the suite's hooks): [{ blockId, onBefore?, onAfter? }] on blocks of the target's canvas, each { kind: 'json', value: '<made-up output as JSON text>' } to skip the block, or { kind: 'script', value: 'return {...input, x: 1}' } (input, output, t.skip(output), t.fail(msg)). if/switch/loops/retry allow only an onBefore script. appConfigOverrides [{ key, value }] and integrationOverrides [{ existingId, newId }] apply to this suite only.
Then run it with run_test_suite.`;

export const testSuiteTools: McpTool[] = [
	{
		name: "save_test_suite",
		description: DESCRIPTION,
		role: "creator",
		annotations: SAVE,
		input: {
			testSuiteId: testSuiteId.optional().describe("Test suite id to update; omit to create"),
			targetType: targetType.optional().describe("Create only: what the suite tests"),
			targetId: z.string().optional().describe("Create only: the route or workflow id"),
			...fields,
		},
		call: async ({ send }, { testSuiteId: id, targetType: kind, targetId, ...a }) => {
			if (id) return { id: (await send("PUT", `/v1/test-suites/${id}`, a)).id };
			if (!kind || !targetId || !a.name) {
				throw new Error("To create a test suite pass targetType, targetId and name.");
			}
			const { name, description, ...rest } = a;
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
		name: "delete_test_suite",
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
