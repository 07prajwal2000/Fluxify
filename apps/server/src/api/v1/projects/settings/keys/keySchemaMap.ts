import z from "zod";

export const projectSettingsKeySchemaMap = {
	"settings.ai.agentConnectionId": {
		schema: z.uuidv7(),
		defaultValue: "",
		dataType: "string",
	},
	"settings.ai.loggerConnectionId": {
		schema: z.uuidv7(),
		defaultValue: "",
		dataType: "string",
	},
	"experimental.workerTimeouts.enabled": {
		schema: z.enum(["true", "false"]),
		defaultValue: "false",
		dataType: "boolean",
	},
};

export type ProjectSettingsKeyType = keyof typeof projectSettingsKeySchemaMap;
