import { calledTool, type Task } from "./checks";

/**
 * Extracting a selection to a custom block (#753). In its own file so the other
 * task files stay under the FTA cap. A sandbox holds two connected blocks.
 */
export const extractTasks: Task[] = [
	{
		id: "extract-custom-block",
		title: "Turn two sandbox blocks into a custom block with extract_custom_block (#753)",
		setup: async (ctx) => {
			const { id } = await ctx.tool("create_sandbox", { projectId: ctx.projectId, name: "draft" });
			const target = { kind: "sandbox", id, projectId: ctx.projectId };
			const canvas = await ctx.tool("get_canvas", { target });
			const entry = canvas.blocks.find((b: any) => b.type === "entrypoint").key;
			await ctx.tool("edit_canvas", {
				target,
				revision: canvas.revision,
				ops: [
					{
						op: "add_block",
						ref: "clean",
						type: "jsrunner",
						data: { value: "return { text: String(input.text).trim() };", blockName: "Trim" },
					},
					{
						op: "add_block",
						ref: "shout",
						type: "jsrunner",
						data: { value: "return { text: input.text.toUpperCase() };", blockName: "Shout" },
					},
					{ op: "connect", from: entry, to: "clean" },
					{ op: "connect", from: "clean", to: "shout" },
				],
			});
			ctx.seed.sandbox = id;
		},
		prompt:
			'My sandbox "draft" has two connected blocks, Trim and Shout. Turn them into a custom block I can reuse, called "Shout text". Keep the sandbox as it is.',
		checks: [
			calledTool("extract_custom_block"),
			{
				name: "the custom block exists",
				run: async (ctx) => {
					const blocks = await ctx.tool("list_custom_blocks", { projectId: ctx.projectId });
					const found = blocks.find((b: any) => /shout_text/.test(b.name));
					return found
						? { pass: true, message: found.name }
						: { pass: false, message: `no shout_text block in ${blocks.map((b: any) => b.name)}` };
				},
			},
			{
				name: "the custom block holds both blocks",
				run: async (ctx) => {
					const blocks = await ctx.tool("list_custom_blocks", { projectId: ctx.projectId });
					const found = blocks.find((b: any) => /shout_text/.test(b.name));
					if (!found) return { pass: false, message: "no custom block" };
					const canvas = await ctx.tool("get_canvas", {
						target: { kind: "custom_block", id: found.id, projectId: ctx.projectId },
					});
					const n = canvas.blocks.filter((b: any) => b.type === "jsrunner").length;
					return n === 2
						? { pass: true, message: "two jsrunner blocks" }
						: { pass: false, message: `${n} jsrunner blocks` };
				},
			},
			{
				name: "left the sandbox as it was",
				run: async (ctx) => {
					const canvas = await ctx.tool("get_canvas", {
						target: { kind: "sandbox", id: ctx.seed.sandbox, projectId: ctx.projectId },
					});
					const n = canvas.blocks.filter((b: any) => b.type === "jsrunner").length;
					return n === 2
						? { pass: true, message: "two jsrunner blocks" }
						: { pass: false, message: `${n} jsrunner blocks` };
				},
			},
		],
		judge: [
			"Extracted with extract_custom_block (by block keys) instead of rebuilding the blocks by hand",
			"Did not replace the selection, since the user said to keep the sandbox",
		],
	},
];
