import z from "zod";
import { baseBlockDataSchema, Context } from "../../baseBlock";

export const logBlockSchema = z
	.object({
		message: z.string().optional().describe("string message to log"),
		level: z
			.enum(["info", "warn", "error"])
			.default("info")
			.describe("log level"),
	})
	.extend(baseBlockDataSchema.shape);

/** `message` arrives already evaluated — the compiler inlines any `js:` value */
export function formatMessage(message: any, level: string, context: Context) {
	const isObject = typeof message == "object" && message !== null;
	const datetime = new Date().toISOString().split("T");
	const date = datetime[0];
	const time = datetime[1].substring(0, datetime[1].lastIndexOf("."));
	const path = context.route;
	return `${level.toUpperCase()}-${path}-${date} ${time}\n${
		isObject ? JSON.stringify(message, null, 2) : message
	}`;
}
