import { calledTool, expectCall, oneRoute, routeWithCode, type Task } from "./checks";

/**
 * Moving blocks between canvases (#752). In its own file so tasks2.ts stays under
 * the FTA cap. A sandbox holds the block; the route needs it between its two blocks.
 */
export const moveBlocksTasks: Task[] = [
	{
		id: "copy-from-sandbox",
		title: "Bring a block from a sandbox into a route with copy_blocks (#752)",
		setup: async (ctx) => {
			await routeWithCode(
				ctx,
				{ method: "GET", path: "/double", active: true },
				'return { n: Number(getQueryParam("n")) };',
			);
			const { id } = await ctx.tool("create_sandbox", { projectId: ctx.projectId, name: "draft" });
			const target = { kind: "sandbox", id, projectId: ctx.projectId };
			const canvas = await ctx.tool("get_canvas", { target });
			const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").key;
			await ctx.tool("edit_canvas", {
				target,
				version: canvas.version,
				ops: [
					{
						op: "add_block",
						ref: "double",
						type: "jsrunner",
						data: { value: "return { result: input.n * 2 };", blockName: "Double n" },
					},
					{ op: "connect", from: entry, to: "double" },
				],
			});
			ctx.seed.sandbox = id;
		},
		prompt:
			'My sandbox "draft" has a block that turns n into { "result": n * 2 }. Put that block into the existing route GET /double, between its first block and its response, so GET /double?n=4 answers { "result": 8 }. Leave the sandbox as it is.',
		checks: [
			calledTool("copy_blocks"),
			oneRoute("GET", "/double"),
			expectCall(
				"doubles n",
				"GET",
				"/double",
				{ query: { n: "4" } },
				{ status: 200, body: { result: 8 } },
			),
			{
				name: "left the sandbox as it was",
				run: async (ctx) => {
					const canvas = await ctx.tool("get_canvas", {
						target: { kind: "sandbox", id: ctx.seed.sandbox, projectId: ctx.projectId },
					});
					const blocks = canvas.blocks.filter((b: any) => b.type === "jsrunner");
					return blocks.length === 1
						? { pass: true, message: "one jsrunner" }
						: { pass: false, message: `${blocks.length} jsrunner blocks` };
				},
			},
		],
		judge: [
			"Moved the block with copy_blocks instead of retyping its code into the route",
			"Wired the copy between the route's first block and its response, with edit_canvas",
			"Checked its own work (call_route or run_test_suite) before saying it was done",
		],
	},
];
