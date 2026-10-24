// What `triggers create` writes: a poll loop that honours `ctx.signal`, emits
// what it found and commits only once the workflow run succeeded.

const label = (name: string) => name.split("/").at(-1)!;

export const triggerTemplate = (type: string) => `import { param } from "@fluxify/sdk/blocks";
import { trigger } from "@fluxify/sdk/triggers";

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
				// an abort that arrived while the last emit was running must not wait a full interval
				if (ctx.signal.aborted) return resolve();
				let timer: ReturnType<typeof setTimeout>;
				const done = () => {
					clearTimeout(timer);
					ctx.signal.removeEventListener("abort", done);
					resolve();
				};
				timer = setTimeout(done, ms);
				ctx.signal.addEventListener("abort", done, { once: true });
			});
		const loop = (async () => {
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
			// anything else that throws is fatal: Fluxify stops this instance and starts it again
		})().catch((error) => ctx.fail(error));
		// called once ctx.signal is aborted: wait for the loop to see it, close your client here
		return async () => {
			await loop;
		};
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
