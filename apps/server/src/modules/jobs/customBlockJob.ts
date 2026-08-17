import {
	CUSTOM_BLOCK_JOB,
	invokeCustomBlock,
	type CustomBlockArgs,
} from "@fluxify/blocks";
import { logger } from "@fluxify/common";
import { createJobContext } from "../requestRouter/service";
import { registerJobHandler } from "./registry";

/**
 * Runs a custom block that its caller queued instead of awaiting.
 *
 * Registered on the execution process — the one that holds the compiled block
 * library and can run user code. It throws on failure so the consumer retries;
 * the caller is long gone, so the queue is the only thing that can.
 */
export function registerCustomBlockJobHandler() {
	registerJobHandler(CUSTOM_BLOCK_JOB, async (job) => {
		const context = createJobContext({
			id: job.id,
			projectId: job.projectId,
			target: job.target,
		});
		try {
			await invokeCustomBlock(
				context,
				job.target,
				(job.payload as CustomBlockArgs) ?? { params: {} },
			);
			logger.info(`[jobs] ran custom block ${job.target}`, "JOBS.custom-block");
		} finally {
			context.dbFactory?.dispose();
		}
	});
}
