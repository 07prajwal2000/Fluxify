import z from "zod";
import { BaseBlock, BlockOutput, Context } from "../../baseBlock";
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
	name: "cloud_logs",
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
	return `await lib.cloudLog(ctx, ${JSON.stringify(connection)}, ${JSON.stringify(level)}, ${emitLogMessage(message, node)}, ${node.in});\n${node.next()}`;
}

export class CloudLogsBlock extends BaseBlock {
	constructor(
		context: Context,
		private readonly logger: AbstractLogger,
		input: z.infer<typeof logBlockSchema>,
		next?: string,
	) {
		super(context, input, next);
	}

	override async executeAsync(params: any): Promise<BlockOutput> {
		const data = this.input as z.infer<typeof logBlockSchema>;
		const level = data.level;
		const msgOrParams = data.message?.trim() != "" ? data.message : params;
		const msg = await formatMessage(
			msgOrParams,
			level,
			this.context,
			params,
			"obj",
		);

		if (level == "info") {
			this.logger.logInfo(msg);
		} else if (level == "error") {
			this.logger.logError(msg);
		} else {
			this.logger.logWarn(msg);
		}
		return {
			continueIfFail: true,
			successful: true,
			next: this.next,
			output: params,
		};
	}
}
