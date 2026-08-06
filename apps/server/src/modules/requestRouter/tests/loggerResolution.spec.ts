import { describe, expect, it } from "bun:test";
import { OpenTelemetryLogs } from "@fluxify/adapters";
import { ConsoleLoggerProvider } from "@fluxify/lib";
import type { Context } from "@fluxify/blocks";
import {
	hydrateIntegrations,
	observabilityIntegrationsCache,
	OWNER_KEY,
} from "../../../loaders/integrationsLoader";
import { hydrateProjectSettings } from "../../../loaders/projectSettingsLoader";
import { setBlocksExecutor } from "../executor";
import { executeRouteInternal } from "../service";

const PROJECT = "project-log";
const INTEGRATION = "integration-otel";
const OTHER_PROJECT_INTEGRATION = "integration-foreign";

const route = { id: "route-1", projectId: PROJECT, projectName: "Project" };
const request = {
	method: "GET",
	path: "/logs",
	headers: {},
	query: {},
	body: null,
	params: {},
};

function seedIntegrations() {
	hydrateIntegrations(PROJECT, {
		observability: {
			[INTEGRATION]: {
				variant: "Open Telemetry",
				baseUrl: "http://collector.test/api/default",
				credentials: { username: "u", password: "p" },
				[OWNER_KEY]: PROJECT,
			},
		},
	});
	hydrateIntegrations("someone-else", {
		observability: {
			[OTHER_PROJECT_INTEGRATION]: {
				variant: "Open Telemetry",
				baseUrl: "http://elsewhere.test/api/default",
				credentials: { username: "u", password: "p" },
				[OWNER_KEY]: "someone-else",
			},
		},
	});
}

/** Runs one request and hands back the context the graph would have received. */
async function contextFor(settings: Record<string, string>) {
	seedIntegrations();
	hydrateProjectSettings(PROJECT, settings);
	let captured: Context = null!;
	setBlocksExecutor(async (_target, context) => {
		captured = context;
		return { successful: true, output: { body: "ok" } } as any;
	});
	await executeRouteInternal(route, request);
	return captured;
}

describe("logger resolution", () => {
	it("uses the telemetry logs key", async () => {
		// the current UI writes only this key — reading the legacy one alone left
		// every project configured through it logging to the server console
		const ctx = await contextFor({
			"settings.telemetry.logsConnectionId": INTEGRATION,
		});
		expect(ctx.vars.logger).toBeInstanceOf(OpenTelemetryLogs);
	});

	it("still honours the legacy logger key", async () => {
		const ctx = await contextFor({
			"settings.ai.loggerConnectionId": INTEGRATION,
		});
		expect(ctx.vars.logger).toBeInstanceOf(OpenTelemetryLogs);
	});

	it("prefers the telemetry key when both are set", async () => {
		const ctx = await contextFor({
			"settings.telemetry.logsConnectionId": INTEGRATION,
			"settings.ai.loggerConnectionId": OTHER_PROJECT_INTEGRATION,
		});
		expect(ctx.vars.logger).toBeInstanceOf(OpenTelemetryLogs);
	});

	it("falls back to the console when the project has no destination", async () => {
		const ctx = await contextFor({});
		expect(ctx.vars.logger).toBeInstanceOf(ConsoleLoggerProvider);
	});

	it("does not write request state into the shared integration config", async () => {
		await contextFor({ "settings.telemetry.logsConnectionId": INTEGRATION });
		// mutating the cache entry cross-labels logs of concurrent requests
		expect(observabilityIntegrationsCache[INTEGRATION].routeId).toBeUndefined();
	});
});

describe("cloud logs block integration factory", () => {
	it("resolves the block's own integration", async () => {
		// compiled graphs call this through `lib.cloudLog`; without it the block
		// threw on a missing factory for every compiled route
		const ctx = await contextFor({});
		const logger = ctx.integrationFactory!.create({
			integrationId: INTEGRATION,
			type: "observability",
		});
		expect(logger).toBeInstanceOf(OpenTelemetryLogs);
	});

	it("refuses another project's integration", async () => {
		const ctx = await contextFor({});
		const logger = ctx.integrationFactory!.create({
			integrationId: OTHER_PROJECT_INTEGRATION,
			type: "observability",
		});
		expect(logger).toBeInstanceOf(ConsoleLoggerProvider);
	});

	it("returns nothing for a group it does not resolve", async () => {
		const ctx = await contextFor({});
		expect(
			ctx.integrationFactory!.create({
				integrationId: INTEGRATION,
				type: "database",
			}),
		).toBeUndefined();
	});
});
