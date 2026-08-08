import { describe, expect, it } from "bun:test";
import { spawnCommand } from "../spawn";

describe("spawnCommand", () => {
	it("applies the descriptor cap through the shell on posix", () => {
		const argv = spawnCommand("/app/entry.ts", "linux", {});
		expect(argv[0]).toBe("/bin/sh");
		expect(argv[2]).toBe(`ulimit -n 256; exec "$0" --smol "$1"`);
		// interpreter and entry are arguments, never interpolated into the script
		expect(argv[3]).toBe(process.execPath);
		expect(argv[4]).toBe("/app/entry.ts");
	});

	it("never sets an address-space limit", () => {
		// `ulimit -v` aborts JSC before user code runs — a plain bun process
		// reserves ~129 GB of address space. The container's mem_limit is the cap.
		expect(spawnCommand("/app/entry.ts", "linux", {})[2]).not.toContain(
			"ulimit -v",
		);
	});

	it("takes the env override for the descriptor cap", () => {
		const argv = spawnCommand("/app/entry.ts", "linux", {
			TEST_RUNNER_MAX_FDS: "64",
		});
		expect(argv[2]).toContain("ulimit -n 64;");
	});

	it("ignores an override that is not a positive integer", () => {
		// the value lands in a shell script, so anything but a number is refused
		const argv = spawnCommand("/app/entry.ts", "linux", {
			TEST_RUNNER_MAX_FDS: "0; rm -rf /",
		});
		expect(argv[2]).toContain("ulimit -n 256;");
		expect(argv[2]).not.toContain("rm -rf");
	});

	it("skips the shell on windows — ulimit does not exist there", () => {
		const argv = spawnCommand("C:\\app\\entry.ts", "win32", {});
		expect(argv).toEqual([process.execPath, "--smol", "C:\\app\\entry.ts"]);
	});
});
