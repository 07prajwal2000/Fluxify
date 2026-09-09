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
	// Telemetry destinations, one observability integration per signal. They are
	// separate keys rather than one because a user with a traces backend and no
	// metrics backend is normal, and nothing says all three live on one endpoint.
	//
	// `settings.ai.loggerConnectionId` is the legacy name for the logs key — it
	// was never AI-specific, it is the project's log destination. Both are read
	// (see `telemetryConnectionId`); the old one is not written to any more.
	"settings.telemetry.logsConnectionId": {
		schema: z.uuidv7(),
		defaultValue: "",
		dataType: "string",
	},
	"settings.telemetry.tracesConnectionId": {
		schema: z.uuidv7(),
		defaultValue: "",
		dataType: "string",
	},
	"settings.telemetry.metricsConnectionId": {
		schema: z.uuidv7(),
		defaultValue: "",
		dataType: "string",
	},
	/**
	 * Largest payload one Trigger Workflow block may carry, in bytes.
	 *
	 * The ceiling is not negotiable: the internal subject is a shared broker, and
	 * a project that can post megabytes onto it degrades every other project's
	 * triggers. Anything bigger belongs on a dedicated trigger with its own
	 * source, where the payload never touches this stream.
	 */
	"settings.triggers.maxPayloadBytes": {
		schema: z.coerce.number().int().min(1024).max(262144),
		defaultValue: "65536",
		dataType: "number",
	},
	"experimental.workerTimeouts.enabled": {
		schema: z.enum(["true", "false"]),
		defaultValue: "false",
		dataType: "boolean",
	},
};

export type ProjectSettingsKeyType = keyof typeof projectSettingsKeySchemaMap;
