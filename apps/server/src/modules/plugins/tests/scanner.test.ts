// The scanner (#861) against a real Postgres and NATS: a scan writes status,
// lastError and scannedAt on the row, clears a source error once the source is
// healthy, and the manual endpoints return the updated rows.
import { describe, expect, it } from "bun:test";
import { sha256Integrity } from "../sources/integrity";
import { call, service, setup, sql, version } from "./harness";

const bytes = new TextEncoder().encode("tarball");

async function plugin(integrity: string) {
	const s = await setup();
	const { registerPluginVersion } = await service();
	const { plugin } = await registerPluginVersion(s.project, {
		...version(s.name, integrity),
		location: `${s.project}/${s.name}/2026.10.2001.tgz`,
	});
	return { s, plugin };
}
const row = async (id: string) => (await sql`SELECT * FROM plugins WHERE id = ${id}`)[0];

describe("plugin scanner", () => {
	it("records a missing object, then clears it once the object is back", async () => {
		const { s, plugin: p } = await plugin(sha256Integrity(bytes));
		const first = await call(s.as, "POST", s.path("/scan"));
		expect(first.status).toBe(200);
		expect(first.body).toMatchObject({ status: "error" });
		expect(first.body.lastError).toContain("missing");
		expect((await row(p.id)).scanned_at).not.toBeNull();

		const { pluginObjects } = await import("../../../db/natsObjects");
		await (await pluginObjects()).put(p.location, bytes);
		const second = await call(s.as, "POST", s.path("/scan"));
		expect(second.body).toMatchObject({ status: "ok", lastError: null });
	});

	it("scans the whole project and returns every row", async () => {
		const { s } = await plugin("sha256-x");
		const res = await call(s.as, "POST", `/plugins/scan?projectId=${s.project}`);
		expect(res.status).toBe(200);
		expect(res.body).toHaveLength(1);
		expect(res.body[0].scannedAt).not.toBeNull();
	});

	it("is for creators", async () => {
		const { s } = await plugin("sha256-x");
		const res = await call({ ...s.as, role: "viewer" }, "POST", s.path("/scan"));
		expect(res.status).toBe(403);
	});
});
