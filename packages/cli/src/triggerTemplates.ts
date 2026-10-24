// What `triggers create` writes: a poll loop on the SDK's `poll`, which honours
// `ctx.signal`, waits between ticks and never leaves a listener behind.

const label = (name: string) => name.split("/").at(-1)!;

export const triggerTemplate = (type: string) => `import { param } from "@fluxify/sdk/blocks";
import { poll, trigger } from "@fluxify/sdk/triggers";

export default trigger({
	name: "${type}",
	label: "${label(type)}",
	icon: "./icons/${label(type)}.svg",
	params: {
		intervalSeconds: param.number({
			label: "Poll every (seconds)",
			default: 30,
			min: 1,
			max: 86400,
			integer: true,
		}),
	},
	async start(ctx) {
		return poll(ctx, {
			every: ctx.params.intervalSeconds * 1000,
			async tick() {
				// fetch new items from your source here (bring your own client)
				const items: unknown[] = [];
				if (!items.length) return;
				try {
					// one workflow run for the batch; resolves once it succeeded
					await ctx.emit(items);
					// commit here: mark the items done in your source, so they are not read again
				} catch (error) {
					// the run failed: leave them uncommitted to retry, or park them
					ctx.logger.logError(error);
				}
			},
			// anything that throws is logged and the loop waits: return "fail" from
			// onError for an error that never fixes itself
		});
	},
});
`;

export const triggerTest = (file: string) => `import { expect, it } from "bun:test";
import { runTrigger } from "@fluxify/sdk/testing";
import poll from "./${file}";

it("polls until stopped", async () => {
	const run = await runTrigger(poll, { params: { intervalSeconds: 1 } });
	await run.stop();
	expect(run.signal.aborted).toBe(true);
	expect(run.emits).toEqual([]);
});
`;
