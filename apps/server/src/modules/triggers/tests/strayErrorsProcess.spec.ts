import { expect, test } from "bun:test";
import { fileURLToPath } from "node:url";

const fixture = fileURLToPath(new URL("./strayErrorsChild.fixture.ts", import.meta.url));

test("errors nobody awaited keep the process up; a trigger's restarts it, anyone else's is logged", async () => {
	const child = Bun.spawn([process.execPath, fixture], {
		env: { ...process.env, NODE_ENV: "test" },
		stdout: "pipe",
		stderr: "pipe",
	});
	const [code, out, err] = await Promise.all([
		child.exited,
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
	]);
	const logs = out + err;
	const report = JSON.parse(/REPORT (.*)/.exec(out)?.[1] ?? "{}");
	// exit 0 is the fixture's own: a crash would have exited 1 before reporting
	expect(code).toBe(0);
	// a floating rejection traced by its stack, an exception traced by its scope: each restarted
	expect(report.loop).toMatchObject({ running: true, failures: 1, lastFailure: "unhandled error: the loop broke" });
	expect(report.timer).toMatchObject({ running: true, failures: 1, lastFailure: "unhandled error: the timer threw" });
	expect(report.starts).toEqual({ "acme/s/loop": 2, "acme/s/timer": 2, "acme/s/emit": 1 });
	// a block's error is still the run's failure, handed to emit, not a crash of the trigger
	expect(report.blockError).toBe("the block broke");
	expect(report.emit).toMatchObject({ running: true, failures: 0 });
	expect(logs).toContain("unhandled rejection, kept running: Error: nobody's rejection");
	expect(logs).toContain("uncaught exception, kept running: Error: nobody's exception");
}, 20_000);
