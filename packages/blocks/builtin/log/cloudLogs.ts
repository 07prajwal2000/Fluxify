import type { AbstractLogger } from "@fluxify/lib";
import z from "zod";
import type { Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { logBlockSchema } from ".";
import { emitLogMessage } from "./console";

export const cloudLogsBlockSchema = z
	.object({
		connection: z.string().describe("integration id").default(""),
	})
	.extend(logBlockSchema.shape);

export const cloudLogsAiDescription = {
	name: BlockTypes.cloudLogs,
	description: "Logs a message to the cloud logging service.",
	jsonSchema: JSON.stringify(z.toJSONSchema(cloudLogsBlockSchema)),
};

/**
 * Runtime half of the compiled `lib.cloudLog(...)` call. The observability
 * integration is resolved per call from the context, so the compiled graph
 * carries only the integration id. `message` is already evaluated.
 */
export function runCloudLog(
	context: Context,
	connection: string,
	level: "info" | "warn" | "error",
	message: any,
) {
	const target: AbstractLogger = context.integrationFactory!.create({
		integrationId: connection,
		type: "observability",
	});
	if (level == "info") {
		target.logInfo(message);
	} else if (level == "error") {
		target.logError(message);
	} else {
		target.logWarn(message);
	}
}

export function emitCloudLogs(node: EmitNode) {
	const { connection, level, message } = cloudLogsBlockSchema.parse(node.block.data);
	return `lib.cloudLog(ctx, ${node.value(connection)}, ${JSON.stringify(level)}, ${emitLogMessage(message, node)});\n${node.next()}`;
}
