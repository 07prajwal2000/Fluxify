import { z } from "zod";

/** In a save's answer when it turns production recording on (#736). */
export const PROD_RECORDING_WARNING =
	"Recording is heavy at scale. Prefer tracing, or open the route in a sandbox to test in isolation.";

/**
 * A route's or workflow's observability, per environment (#736). The
 * unprefixed pair is production's. Settings, not definition: they apply live
 * and are never versioned (#738).
 */
export const observabilityFields = {
	tracingEnabled: z
		.boolean()
		.optional()
		.describe("Production: export spans to the project's tracing destination. Off by default"),
	recordExecution: z
		.boolean()
		.optional()
		.describe("Production: record every run for the trace viewer. Off by default; heavy at scale"),
	devTracingEnabled: z
		.boolean()
		.optional()
		.describe("Development: export spans to the project's tracing destination. Off by default"),
	devRecordExecution: z
		.boolean()
		.optional()
		.describe("Development: record every run for the trace viewer. On by default"),
};

export const warningField = {
	warning: z.string().optional().describe("Something to tell the user about this save"),
};

export const prodRecordingWarning = (data: { recordExecution?: boolean }) =>
	data.recordExecution ? { warning: PROD_RECORDING_WARNING } : {};
