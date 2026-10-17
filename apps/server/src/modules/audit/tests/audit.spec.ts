import { afterEach, describe, expect, it, spyOn } from "bun:test";
import { audit, transport } from "../audit";
import { runWithAuditContext } from "../context";
import { gateOverride } from "../gate";
import type { AuditEvent } from "../types";

const ACTOR = { actorId: "u1", actorEmail: "ada@example.com" };
const base = { resourceType: "route", resourceId: "r1", action: "update", changedFields: ["name"] };

function publishSpy() {
	return spyOn(transport, "publish").mockResolvedValue(undefined);
}

afterEach(() => {
	gateOverride.licensed = undefined;
	gateOverride.projectEnabled = undefined;
	spyOn(transport, "publish").mockRestore();
});

describe("audit.record gate", () => {
	it("is a no-op in a community build, with no request context and no database", async () => {
		const publish = publishSpy();
		await audit.record({ ...base, projectId: "p1" });
		await audit.record(base);
		expect(publish).not.toHaveBeenCalled();
	});

	it("skips a project that has audit logs off", async () => {
		gateOverride.licensed = true;
		gateOverride.projectEnabled = false;
		const publish = publishSpy();
		await audit.record({ ...base, projectId: "p1" });
		expect(publish).not.toHaveBeenCalled();
	});

	it("needs the licence only for an instance-level event", async () => {
		gateOverride.licensed = true;
		gateOverride.projectEnabled = false;
		const publish = publishSpy();
		await runWithAuditContext({ actor: ACTOR, source: "portal" }, () =>
			audit.record({ ...base, resourceType: "instance_setting" }),
		);
		expect(publish).toHaveBeenCalledTimes(1);
		expect((publish.mock.calls[0]![0] as AuditEvent).projectId).toBeNull();
	});

	it("checks the licence before it looks at the project or the actor", async () => {
		gateOverride.licensed = false;
		gateOverride.projectEnabled = true;
		const publish = publishSpy();
		// no context and no actor would throw if the gate did not stop it first
		await audit.record({ ...base, projectId: () => Promise.reject(new Error("looked up")) });
		expect(publish).not.toHaveBeenCalled();
	});
});

describe("audit.record event", () => {
	it("takes the actor and source from the request context", async () => {
		gateOverride.licensed = true;
		gateOverride.projectEnabled = true;
		const publish = publishSpy();
		await runWithAuditContext({ actor: ACTOR, source: "mcp" }, () =>
			audit.record({ ...base, projectId: "p1", project: { name: "Shop", slug: "shop" } }),
		);
		const event = publish.mock.calls[0]![0] as AuditEvent;
		expect(event).toMatchObject({
			actorId: "u1",
			actorEmail: "ada@example.com",
			source: "mcp",
			projectId: "p1",
			projectName: "Shop",
			projectSlug: "shop",
			resourceType: "route",
			resourceId: "r1",
			action: "update",
			changedFields: ["name"],
			status: "success",
		});
		expect(event.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
		expect(new Date(event.ts).getTime()).toBeGreaterThan(0);
	});

	it("takes an explicit actor when there is no request, such as a background job", async () => {
		gateOverride.licensed = true;
		const publish = publishSpy();
		await audit.record({ ...base, actor: { ...ACTOR, source: "portal" } });
		expect((publish.mock.calls[0]![0] as AuditEvent).actorId).toBe("u1");
	});

	it("refuses an anonymous change once the gate has passed", async () => {
		gateOverride.licensed = true;
		publishSpy();
		await expect(audit.record(base)).rejects.toThrow(/no request context/);
	});

	it("does not record a change to a project it cannot find", async () => {
		gateOverride.licensed = true;
		const publish = publishSpy();
		await runWithAuditContext({ actor: ACTOR, source: "portal" }, () =>
			audit.record({ ...base, projectId: async () => null }),
		);
		expect(publish).not.toHaveBeenCalled();
	});

	it("resolves a project lookup only after the gate", async () => {
		gateOverride.licensed = true;
		gateOverride.projectEnabled = true;
		const publish = publishSpy();
		await runWithAuditContext({ actor: ACTOR, source: "portal" }, () =>
			audit.record({ ...base, projectId: async () => "p9", project: { name: "N", slug: "n" } }),
		);
		expect((publish.mock.calls[0]![0] as AuditEvent).projectId).toBe("p9");
	});

	it("lets a failed publish reach the caller, so its transaction rolls back", async () => {
		gateOverride.licensed = true;
		spyOn(transport, "publish").mockRejectedValue(new Error("nats is down"));
		await expect(
			runWithAuditContext({ actor: ACTOR, source: "portal" }, () => audit.record(base)),
		).rejects.toThrow("nats is down");
	});

	it("keeps values out: odd field names are dropped and the message is scrubbed", async () => {
		gateOverride.licensed = true;
		const publish = publishSpy();
		await runWithAuditContext({ actor: ACTOR, source: "portal" }, () =>
			audit.record({
				...base,
				changedFields: ["config.password", "my secret value here", "name"],
				message: "failed with password=hunter2 for postgres://admin:s3cret@db:5432/x",
			}),
		);
		const event = publish.mock.calls[0]![0] as AuditEvent;
		expect(event.changedFields).toEqual(["config.password", "name"]);
		expect(JSON.stringify(event)).not.toContain("hunter2");
		expect(JSON.stringify(event)).not.toContain("s3cret");
	});
});
