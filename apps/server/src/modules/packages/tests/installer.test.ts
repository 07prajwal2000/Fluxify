import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DepsInstallStatus } from "@fluxify/common/orchestrator";
import type { DepsArtifact } from "../../compiler/artifacts";
import { currentLink, versionDir } from "../depsDir";
import { createDepsInstaller } from "../installer";
import { resolveDependencies } from "../resolver";

// Real `bun install` against the npm registry, so it lives in *.test.ts (CI only).
describe("createDepsInstaller", () => {
	const root = mkdtempSync(join(tmpdir(), "deps-install-"));
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	let latest: Record<string, DepsInstallStatus> = {};
	const installed: string[] = [];
	const installer = createDepsInstaller({
		root,
		onStatus: (s) => {
			latest = s;
		},
		onInstalled: async (projectId) => {
			installed.push(projectId);
		},
	});

	const artifact = async (version: number, add: string[]): Promise<DepsArtifact> => ({
		projectId: "p1",
		version,
		...(await resolveDependencies(null, { add: add.map((name) => ({ name })) }, 0)),
		updatedAt: new Date().toISOString(),
	});

	it("installs a version, points current at it, and reports ready", async () => {
		installer.apply("p1", await artifact(1, ["ms"]));
		await installer.idle();

		expect(latest.p1).toEqual({ version: 1, state: "ready" });
		expect(installed).toEqual(["p1"]);
		expect(realpathSync(Bun.resolveSync("ms", `${currentLink("p1", root)}/`))).toContain(`${join("p1", "v1")}`);
	}, 120_000);

	it("replaces the old version on update and removes its directory", async () => {
		installer.apply("p1", await artifact(2, ["ms", "lodash"]));
		await installer.idle();

		expect(latest.p1?.state).toBe("ready");
		expect(latest.p1?.version).toBe(2);
		expect(existsSync(versionDir("p1", 1, root))).toBe(false);
		expect(realpathSync(Bun.resolveSync("lodash", `${currentLink("p1", root)}/`))).toContain(join("p1", "v2"));
	}, 120_000);

	it("skips an install the node already has", async () => {
		installed.length = 0;
		installer.apply("p1", await artifact(2, ["ms", "lodash"]));
		await installer.idle();
		expect(installed).toEqual([]);
		expect(latest.p1?.state).toBe("ready");
	}, 120_000);

	it("reports a lockfile that will not install as failed, keeping current", async () => {
		const good = await artifact(3, ["ms"]);
		installer.apply("p1", { ...good, lockfile: "{ not a lockfile" });
		await installer.idle();

		expect(latest.p1?.state).toBe("failed");
		expect(latest.p1?.error).toBeTruthy();
		expect(realpathSync(Bun.resolveSync("lodash", `${currentLink("p1", root)}/`))).toContain(join("p1", "v2"));
	}, 120_000);

	it("removes everything when the project drops its packages", async () => {
		installer.apply("p1", null);
		await installer.idle();
		expect(latest.p1).toBeUndefined();
		expect(existsSync(join(root, "p1"))).toBe(false);
	});
});
