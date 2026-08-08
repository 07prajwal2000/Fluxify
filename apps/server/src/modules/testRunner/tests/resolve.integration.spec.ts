import { describe, expect, it, mock } from "bun:test";
import { fileURLToPath } from "node:url";

/**
 * The unit spec proves the resolution rules. This one proves the result is
 * actually usable by a child process: spawn one, ship the payload over IPC,
 * and have it hydrate and read the values back through the runtime accessors.
 *
 * Catches what an in-process assertion cannot — a payload that is not
 * structured-cloneable, or a loader that only works when the module cache was
 * already warm.
 */
const PROJECT = "p1";
// fileURLToPath, not .pathname — the latter yields "/D:/..." on Windows
const CHILD = fileURLToPath(
	new URL("./fixtures/hydrateChild.ts", import.meta.url),
);

const rows = [
	{
		id: "pg-1",
		group: "database",
		variant: "PostgreSQL",
		config: { source: "url", url: "cfg:PG_URL" },
		projectId: PROJECT,
	},
];

mock.module("../../../db", () => ({
	db: {
		select: () => ({ from: () => ({ where: async () => rows }) }),
	},
}));

const { resolveSuiteConfig } = await import("../resolve");
const { hydrateAppConfig } = await import("../../../loaders/appconfigLoader");

hydrateAppConfig(PROJECT, {
	PG_URL: "postgres://real:real@prod-host:5432/proddb",
});

/** spawn, bootstrap, wait for the child's answer, always reap it */
async function hydrateInChild(payload: unknown) {
	const { promise, resolve, reject } = Promise.withResolvers<any>();
	const child = Bun.spawn([process.execPath, CHILD], {
		stdout: "inherit",
		stderr: "inherit",
		ipc(message: any) {
			if (message?.type === "ready") {
				child.send({ type: "bootstrap", projectId: PROJECT, payload });
			} else if (message?.type === "hydrated") {
				resolve(message);
			}
		},
		onExit(_p, code) {
			// resolve() already settled it on the happy path
			reject(new Error(`child exited early (code=${code})`));
		},
	});

	const timer = setTimeout(
		() => reject(new Error("child never reported back")),
		15_000,
	);
	try {
		return await promise;
	} finally {
		clearTimeout(timer);
		child.kill();
	}
}

describe("resolveSuiteConfig over IPC", () => {
	it("hydrates a cold child with the overridden config", async () => {
		const payload = await resolveSuiteConfig(PROJECT, {
			appConfigOverrides: [
				{ key: "PG_URL", value: "postgres://test:test@test-host:5432/testdb" },
			],
		});

		// plain data only — a class instance or a function would throw here, and
		// would throw on child.send() too
		expect(() => structuredClone(payload)).not.toThrow();

		const result = await hydrateInChild(payload);
		expect(result.host).toBe("test-host");
		expect(result.database).toBe("testdb");
		expect(result.dbType).toBe("pg");
		expect(result.pgUrl).toBe("postgres://test:test@test-host:5432/testdb");
	}, 20_000);
});
