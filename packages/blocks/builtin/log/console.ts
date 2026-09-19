import { logger } from "@fluxify/common";
import z from "zod";
import type { Context } from "../../baseBlock";
import { BlockTypes } from "../../blockTypes";
import type { EmitNode } from "../../compiler";
import { formatMessage, logBlockSchema } from ".";

/** runtime half of the compiled `lib.log(...)` call; `message` is already evaluated */
export function runConsoleLog(context: Context, level: "info" | "warn" | "error", message: any) {
	const msg = formatMessage(message, level, context);
	if (level == "info") {
		logger.info(msg, "BLOCKS.console");
	} else if (level == "error") {
		logger.error(msg, "BLOCKS.console");
	} else {
		logger.warn(msg, "BLOCKS.console");
	}
}

/** the configured message wins over the flowing value, exactly as the block does */
export function emitLogMessage(message: string | undefined, node: EmitNode) {
	return message?.trim() ? node.value(message) : node.in;
}

export function emitConsoleLog(node: EmitNode) {
	const { level, message } = logBlockSchema.parse(node.block.data);
	return `lib.log(ctx, ${JSON.stringify(level)}, ${emitLogMessage(message, node)});\n${node.next()}`;
}

export const consoleAiDescription = {
	name: BlockTypes.consolelog,
	description: "Logs a message to the system console.",
	jsonSchema: JSON.stringify(z.toJSONSchema(logBlockSchema)),
};
