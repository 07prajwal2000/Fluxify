import { buildEvent, resolveActor } from "./event";
import { gateOverride, licensed, projectInfo } from "./gate";
import type { AuditRecordInput } from "./types";

/**
 * Loaded on first use after the gate, so a process that never records
 * (community, or every spec) never touches NATS.
 */
export const transport = {
	publish: async (event: Parameters<typeof import("./publish").publishAuditEvent>[0]) =>
		(await import("./publish")).publishAuditEvent(event),
};

/**
 * Says what changed. Services call this as the LAST step of their transaction:
 * a failed publish throws, the transaction rolls back and the action fails.
 *
 * The gate runs first and is a cheap no-op: not licensed, or the project has
 * audit logs off, returns before anything else is looked at. Instance-level
 * events (no `projectId`) need the licence only.
 */
async function record(input: AuditRecordInput): Promise<void> {
	if (!licensed()) return;
	const resolved =
		typeof input.projectId === "function" ? await input.projectId() : input.projectId;
	// a lookup that finds no project cannot be attributed, and an event with no
	// project would dodge the per-project switch, so it is not recorded
	if (typeof input.projectId === "function" && !resolved) return;
	const projectId = resolved ?? null;
	let project: { name: string; slug: string } | null = null;
	if (projectId) {
		const enabled = input.project?.enabled ?? gateOverride.projectEnabled;
		if (enabled === false) return;
		let name = input.project?.name;
		let slug = input.project?.slug;
		if (enabled === undefined || name === undefined || slug === undefined) {
			const info = await projectInfo(projectId);
			if (enabled === undefined && !info?.enabled) return;
			name ??= info?.name ?? "";
			slug ??= info?.slug ?? "";
		}
		project = { name, slug };
	}

	const event = buildEvent(input, project, await resolveActor(input.actor), projectId);
	await transport.publish(event);
}

export const audit = { record };
