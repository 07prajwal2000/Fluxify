import { projectSettingsCache } from "../../loaders/projectSettingsLoader";

/**
 * How large a payload the Trigger Workflow block may publish.
 *
 * The default is deliberately well under the ceiling: most triggers pass an id
 * and a couple of fields, and a generous default only teaches people to move
 * whole documents through the broker. Raising it is a per-project decision;
 * going past the ceiling is not a decision at all, because the internal subject
 * is shared and one project's megabytes are every project's latency.
 */
export const TRIGGER_PAYLOAD_KEY = "settings.triggers.maxPayloadBytes";
export const DEFAULT_TRIGGER_PAYLOAD_BYTES = 64 * 1024;
export const MAX_TRIGGER_PAYLOAD_BYTES = 256 * 1024;

export function triggerPayloadLimit(projectId: string) {
	const configured = Number(projectSettingsCache[projectId]?.[TRIGGER_PAYLOAD_KEY]);
	if (!Number.isFinite(configured) || configured <= 0)
		return DEFAULT_TRIGGER_PAYLOAD_BYTES;
	return Math.min(configured, MAX_TRIGGER_PAYLOAD_BYTES);
}
