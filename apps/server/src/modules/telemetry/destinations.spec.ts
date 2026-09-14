import { describe, expect, it } from "bun:test";
import {
	hydrateIntegrations,
	OWNER_KEY,
} from "../../loaders/integrationsLoader";
import { hydrateProjectSettings } from "../../loaders/projectSettingsLoader";
import { exportTraceRun, resolveDestination } from "./destinations";

const PROJECT = "project-telemetry";
const OTHER = "project-other";

hydrateIntegrations(PROJECT, {
	observability: {
		"otel-own": {
			baseUrl: "http://collector.test/api/default/",
			credentials: { username: "u", password: "p" },
			[OWNER_KEY]: PROJECT,
		},
	},
});
hydrateIntegrations(OTHER, {
	observability: {
		"otel-foreign": { baseUrl: "http://foreign.test", [OWNER_KEY]: OTHER },
	},
});

describe("resolveDestination", () => {
	it("reads the destination from the hydrated project config", () => {
		hydrateProjectSettings(PROJECT, {
			"settings.telemetry.tracesConnectionId": "otel-own",
		});

		expect(resolveDestination(PROJECT, "traces")).toEqual({
			integrationId: "otel-own",
			baseUrl: "http://collector.test/api/default",
			headers: {
				Authorization: `Basic ${btoa("u:p")}`,
				"stream-name": `traces_${PROJECT}`,
			},
		});
		expect(resolveDestination(PROJECT, "metrics")).toBeNull();
	});

	it("refuses another project's integration", () => {
		hydrateProjectSettings(PROJECT, {
			"settings.telemetry.tracesConnectionId": "otel-foreign",
		});

		expect(resolveDestination(PROJECT, "traces")).toBeNull();
	});
});

describe("exportTraceRun", () => {
	it("is a no-op for a project with no destination", () => {
		hydrateProjectSettings(PROJECT, {});

		expect(() =>
			exportTraceRun({
				runId: "run-1",
				projectId: PROJECT,
				startedAtWallMs: Date.now(),
				perfOrigin: 0,
				endedAt: 1,
				outcome: "success",
				spans: [],
			}),
		).not.toThrow();
	});
});
