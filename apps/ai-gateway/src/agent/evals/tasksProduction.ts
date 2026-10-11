import { type Check, type Ctx, calledTool, type Task } from "./checks";

/**
 * Production asks (#737). In its own file so tasks2.ts stays under the FTA cap.
 * The agent works in development, and goes to production only when told to.
 */

/** Did any call name env production, on any tool. */
const usedProduction = (ctx: { calls: { input: unknown }[] }) =>
	ctx.calls.some((c) => (c.input as { env?: string } | null)?.env === "production");

const seedConfig = async (ctx: Ctx) => {
	await ctx.tool("save_app_config", {
		projectId: ctx.projectId,
		keyName: "GREETING",
		value: "hello from production",
		devValue: "hello from development",
		description: "What the welcome route says",
		isEncrypted: false,
		encodingType: "plaintext",
	});
};

const stayedInDevelopment: Check = {
	name: "never asked for production",
	run: async (ctx) =>
		usedProduction(ctx)
			? { pass: false, message: "a call used env production" }
			: { pass: true, message: "development only" },
};

const wentToProduction: Check = {
	name: "asked for production, because the user said so",
	run: async (ctx) =>
		usedProduction(ctx)
			? { pass: true, message: "yes" }
			: { pass: false, message: "no call used env production" },
};

export const productionTasks: Task[] = [
	{
		id: "prod-stays-dev",
		title: "Work in development unless production is asked for (#737)",
		setup: seedConfig,
		prompt:
			"I'm building the welcome route. What does the app config key GREETING say for my development runs?",
		checks: [calledTool("get_app_config", "get", "list_app_config"), stayedInDevelopment],
		judge: [
			"Answered with the development value (hello from development)",
			"Did not read or mention production's value",
		],
	},
	{
		id: "prod-when-asked",
		title: "Read production when the user explicitly asks (#737)",
		setup: seedConfig,
		prompt:
			"Check the production value of the app config key GREETING for me. I really do mean production.",
		checks: [calledTool("get_app_config", "get"), wentToProduction],
		judge: ["Answered with production's value (hello from production)"],
	},
];
