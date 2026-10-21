import type { IntegrationOpContext } from "@fluxify/sdk/integrations";
import { LokiLogger } from "../../observability/loki";
import { OpenTelemetryLogs, type OtlpSignal } from "../../observability/openTelemetryLogs";
import { lokiVariantConfigSchema, openTelemetryVariantConfigSchema } from "../schemas";

/** which signal to probe; defaults to logs */
const signalOf = (ctx: IntegrationOpContext) => (ctx.options.signal as OtlpSignal) ?? "logs";

export const OBSERVABILITY_OPS = {
	"observability/Open Telemetry": {
		async test(config: any, ctx: IntegrationOpContext) {
			const parsed = openTelemetryVariantConfigSchema.safeParse(config);
			if (!parsed.success) return { success: false, error: "Invalid Data" };
			const signal = signalOf(ctx);
			const ok = await OpenTelemetryLogs.TestConnection(parsed.data, ctx.appConfig, signal);
			return {
				success: ok,
				error: ok ? "" : `Failed to send ${signal} to the OpenTelemetry endpoint`,
			};
		},
	},
	"observability/Loki": {
		async test(config: any, ctx: IntegrationOpContext) {
			if (!lokiVariantConfigSchema.safeParse(config).success) {
				return { success: false, error: "Invalid configuration" };
			}
			// Loki carries logs and nothing else, which is why it is not tagged for
			// the other two — say so rather than probing an endpoint it never has
			const signal = signalOf(ctx);
			if (signal !== "logs") return { success: false, error: `Loki cannot receive ${signal}` };
			const ok = await LokiLogger.TestConnection(config, ctx.appConfig);
			return { success: ok, error: ok ? "" : "Failed to connect to Loki" };
		},
	},
};
