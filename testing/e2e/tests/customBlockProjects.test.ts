import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { type JobRequest, setJobEnqueuer } from "@fluxify/blocks";
import { registerCustomBlockJobHandler } from "@fluxify/server/src/modules/jobs/customBlockJob";
import { runJob } from "@fluxify/server/src/modules/jobs/registry";
import { registerFixtureBlocks } from "../src/customBlocks";
import { loadGraph } from "../src/graph";
import { runGraph } from "../src/runner";

/**
 * Two projects, one custom block name, one worker.
 *
 * A `*` worker (every dev worker, and a catch-all prod one) holds every
 * project's custom blocks in one library, so a block called `greeting` in two
 * projects must not overwrite or answer for each other. Each project's route
 * calls its own `greeting` three ways — sync, async and queued — and each way
 * has to end up in that project's block.
 *
 * Nothing re-registers a block when a route runs (`uses: []`): both projects'
 * blocks are loaded up front, the way a worker has them before any traffic.
 * Project A's block writes "a" to a shared list each time it runs, project B's
 * writes "b", so a call nobody awaits still shows which block served it.
 */
const projects = [
	{ who: "a", fixture: await loadGraph("custom-blocks/scoped-a") },
	{ who: "b", fixture: await loadGraph("custom-blocks/scoped-b") },
] as const;

const served = () => ((globalThis as { __scopedRuns?: string[] }).__scopedRuns ??= []);
let queued: JobRequest[] = [];
const held: Array<{ dispose(): void }> = [];

beforeAll(async () => {
	for (const { fixture } of projects) {
		held.push(await registerFixtureBlocks(fixture, fixture.projectId!));
	}
	registerCustomBlockJobHandler();
});

afterAll(() => {
	for (const blocks of held) blocks.dispose();
	setJobEnqueuer();
});

beforeEach(() => {
	served().length = 0;
	queued = [];
	setJobEnqueuer((job) => queued.push(job));
});

describe("custom blocks of two projects on one worker", () => {
	for (const { who, fixture } of projects) {
		it(`project ${who.toUpperCase()}'s route runs project ${who.toUpperCase()}'s block`, async () => {
			const run = await runGraph({ ...fixture, uses: [] });

			// sync took the block's output; async ran it on this worker and moved on
			expect(run.status).toBe(200);
			expect(run.body).toBe(`from-${who}`);
			expect(served()).toEqual([who, who]);

			// queued went to the job queue under this project, by the block's name
			expect(queued).toHaveLength(1);
			expect(queued[0]).toMatchObject({
				kind: "custom-block",
				projectId: fixture.projectId,
				target: "greeting",
			});

			// and the worker that takes the job runs this project's block, not the other's
			await runJob({
				...queued[0]!,
				id: crypto.randomUUID(),
				enqueuedAt: new Date().toISOString(),
			});
			expect(served()).toEqual([who, who, who]);
		});
	}
});
