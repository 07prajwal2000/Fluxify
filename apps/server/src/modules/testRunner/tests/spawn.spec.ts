import { describe, expect, it } from "bun:test";
import { spawnCommand } from "../spawn";

describe("spawnCommand", () => {
	it("applies fd and address-space caps through the shell on posix", () => {
		const argv = spawnCommand("/app/entry.ts", "linux", {});
		expect(argv[0]).toBe("/bin/sh");
		expect(argv[2]).toBe(
			`ulimit -n 256; ulimit -v 1048576; exec "$0" --smol "$1"`,
		);
		// interpreter and entry are arguments, never interpolated into the script
		expect(argv[3]).toBe(process.execPath);
		expect(argv[4]).toBe("/app/entry.ts");
	});

	it("takes the env overrides for both caps", () => {
		const argv = spawnCommand("/app/entry.ts", "linux", {
			TEST_RUNNER_MAX_FDS: "64",
			TEST_RUNNER_MAX_VMEM_KB: "524288",
		});
		expect(argv[2]).toContain("ulimit -n 64;");
		expect(argv[2]).toContain("ulimit -v 524288;");
	});

	it("ignores an override that is not a positive integer", () => {
		// the value lands in a shell script, so anything but a number is refused
		const argv = spawnCommand("/app/entry.ts", "linux", {
			TEST_RUNNER_MAX_FDS: "0; rm -rf /",
			TEST_RUNNER_MAX_VMEM_KB: "-1",
		});
		expect(argv[2]).toContain("ulimit -n 256;");
		expect(argv[2]).toContain("ulimit -v 1048576;");
		expect(argv[2]).not.toContain("rm -rf");
	});

	it("skips the shell on windows — ulimit does not exist there", () => {
		const argv = spawnCommand("C:\\app\\entry.ts", "win32", {});
		expect(argv).toEqual([process.execPath, "--smol", "C:\\app\\entry.ts"]);
	});
});
