import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { beginStartup, StartupReport, startup } from "./report";

describe("StartupReport", () => {
	let captured = "";
	let writeSpy: any;

	beforeEach(() => {
		captured = "";
		writeSpy = spyOn(process.stdout, "write").mockImplementation((str: any) => {
			captured += str.toString();
			return true;
		});
	});

	afterEach(() => writeSpy.mockRestore());

	it("renders subsystems, settings, health and the listen address as plain lines, once", () => {
		const report = new StartupReport("fluxify.test");
		report.subsystem("Postgres", "connected");
		report.subsystem("Redis", "failed", "connection refused");
		report.setting("Worker mode: routes and workflows");
		report.health("http://localhost:5600/_/admin/api/healthchecks/ready");
		report.listening("http://localhost:5600");

		report.render();
		report.render();

		expect(captured).toContain("Postgres: connected");
		expect(captured).toContain("Redis: failed: connection refused");
		expect(captured).toContain("Worker mode: routes and workflows");
		expect(captured).toContain("health on http://localhost:5600/_/admin/api/healthchecks/ready");
		expect(captured).toContain("listening on http://localhost:5600");
		expect(captured).not.toContain("╔");
		// order: subsystems -> settings -> health -> listening
		expect(captured.indexOf("Postgres: connected")).toBeLessThan(
			captured.indexOf("Worker mode: routes and workflows"),
		);
		expect(captured.indexOf("Worker mode: routes and workflows")).toBeLessThan(
			captured.indexOf("health on "),
		);
		expect(captured.indexOf("health on ")).toBeLessThan(captured.indexOf("listening on "));
	});

	it("startup() is a detached no-op until beginStartup is called", () => {
		startup().subsystem("x", "connected").render();
		expect(captured).toBe("");
		expect(beginStartup("fluxify.detached-check")).toBeInstanceOf(StartupReport);
	});
});
