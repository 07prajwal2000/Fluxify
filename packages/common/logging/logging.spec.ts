import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import { logger, initializeLogger } from "./index";

describe("Structured Logger", () => {
	let consoleSpy: any;
	let capturedLogs: string[] = [];

	beforeEach(() => {
		capturedLogs = [];
		consoleSpy = spyOn(process.stdout, "write").mockImplementation((str: any) => {
			capturedLogs.push(str.toString());
			return true;
		});
	});

	afterEach(() => {
		// Restore
	});

	it("should output structured format with explicit module string", () => {
		logger.info("Connected to Redis", "redis");
		const log = capturedLogs.join("");
		expect(log).toMatch(/\[fluxify\] \[INFO\] \[redis\] Connected to Redis/);
	});

	it("should output structured format with metadata object", () => {
		logger.info("Connected to PG", "pg", { host: "127.0.0.1" });
		const log = capturedLogs.join("");
		expect(log).toMatch(/\[fluxify\] \[INFO\] \[pg\] Connected to PG {"host":"127.0.0.1"}/);
	});

	it("should output structured format with module inside metadata", () => {
		logger.info("Connected to NATS", { module: "nats", port: 4222 });
		const log = capturedLogs.join("");
		expect(log).toMatch(/\[fluxify\] \[INFO\] \[nats\] Connected to NATS {"port":4222}/);
	});

	it("should fallback to caller filename when module is not passed", () => {
		logger.info("Default module test");
		const log = capturedLogs.join("");
		expect(log).toMatch(/\[fluxify\] \[INFO\] \[logging\.spec\] Default module test/);
	});

	it("should support BLOCKS.<name> format", () => {
		logger.info("Executing insert block", "BLOCKS.insert");
		const log = capturedLogs.join("");
		expect(log).toMatch(/\[fluxify\] \[INFO\] \[BLOCKS\.insert\] Executing insert block/);
	});

	it("should automatically extract module and strip bracketed prefix from message string", () => {
		logger.info("[DbService] Error searching routes");
		const log = capturedLogs.join("");
		expect(log).toMatch(/\[fluxify\] \[INFO\] \[DbService\] Error searching routes/);
	});
});
