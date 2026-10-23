// What `triggers create` writes: a poll loop that honours `ctx.signal`, emits
// what it found and commits only once the workflow run succeeded.

const label = (name: string) => name.split("/").at(-1)!;

export const triggerTemplate = (type: string) => `import { param } from "@fluxify/sdk/blocks";
import { trigger } from "@fluxify/sdk/triggers";

// the loop's handle, so stop() can wait for it to finish
let loop: Promise<void> | undefined;

export default trigger({
	name: "${type}",
	label: "${label(type)}",
	icon: "./icons/${label(type)}.svg",
	params: {
		intervalSeconds: param.number({ label: "Poll every (seconds)", default: 30 }),
	},
	async start(ctx) {
		const wait = (ms: number) =>
			new Promise<void>((resolve) => {
				const timer = setTimeout(resolve, ms);
				ctx.signal.addEventListener("abort", () => (clearTimeout(timer), resolve()), { once: true });
			});
		loop = (async () => {
			while (!ctx.signal.aborted) {
				// fetch new items from your source here (bring your own client)
				const items: unknown[] = [];
				if (items.length)
					try {
						// one workflow run for the batch; resolves once it succeeded
						await ctx.emit(items);
						// commit here: mark the items done in your source, so they are not read again
					} catch (error) {
						// the run failed: leave them uncommitted to retry, or park them
						ctx.logger.logError(error);
					}
				await wait(ctx.params.intervalSeconds * 1000);
			}
		})();
	},
	async stop() {
		// ctx.signal is already aborted: wait for the loop to see it
		await loop;
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
