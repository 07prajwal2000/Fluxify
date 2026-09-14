import { BlockTypes } from "../../blockTypes";
import z from "zod";
import { Context } from "../../baseBlock";
import { formatMessage, logBlockSchema } from ".";
import { AbstractLogger } from "@fluxify/lib";
import type { EmitNode } from "../../compiler";
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
 * Shared by the interpreted block and the compiled `lib.cloudLog(...)` call.
 * The observability integration is resolved per call from the context, so the
 * compiled graph carries only the integration id.
 */
export async function runCloudLog(
	context: Context,
	connection: string,
	level: "info" | "warn" | "error",
	message: any,
	params: any,
) {
	const target: AbstractLogger = context.integrationFactory!.create({
		integrationId: connection,
		type: "observability",
	});
	const msg = await formatMessage(message, level, context, params, "obj");
	if (level == "info") {
		target.logInfo(msg);
	} else if (level == "error") {
		target.logError(msg);
	} else {
		target.logWarn(msg);
	}
}

export function emitCloudLogs(node: EmitNode) {
	const { connection, level, message } = cloudLogsBlockSchema.parse(
		node.block.data,
	);
	return `await lib.cloudLog(ctx, ${node.value(connection)}, ${JSON.stringify(level)}, ${emitLogMessage(message, node)}, ${node.in});\n${node.next()}`;
}
