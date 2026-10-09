/** The resource types the agent can point at with `:ref[Label]{type=<type> id=<id>}`. */
export const REF_TYPES = [
	"route",
	"workflow",
	"trigger",
	"custom_block",
	"middleware",
	"integration",
	"app_config",
	"test_suite",
] as const;
export type RefType = (typeof REF_TYPES)[number];

export const isRefType = (v: unknown): v is RefType => REF_TYPES.includes(v as RefType);

/** The directive for a resource, as the prompt editor writes it and the agent is taught to write it. */
export function refText(type: RefType, id: string | number, label: string) {
	const clean = label.replace(/[[\]\r\n]+/g, " ").trim() || type;
	const value = String(id);
	return `:ref[${clean}]{type=${type} id=${/^[\w-]+$/.test(value) ? value : JSON.stringify(value)}}`;
}

/** Matches a whole `:ref[Label]{type=… id=…}` (the editor turns these into chips). */
export const REF_PATTERN = /:ref\[([^\]\n]*)\]\{type=(\w+) id=("[^"\n]*"|[^\s}]+)\}/g;

/**
 * The portal page of a resource, or undefined when it has none yet. A test suite
 * has no page of its own: it opens on its route's or workflow's tests tab.
 */
export function refPath(
	projectId: string,
	type: RefType,
	id: string,
	suite?: { routeId?: string | null; workflowId?: string | null },
) {
	const p = `/${projectId}`;
	switch (type) {
		case "route":
			return `${p}/canvas/${id}`;
		case "workflow":
			return `${p}/workflow-canvas/${id}`;
		case "trigger":
			return `${p}/triggers`;
		case "custom_block":
			return `${p}/custom-block-canvas/${id}`;
		case "middleware":
			return `${p}/middlewares/${id}`;
		case "integration":
			return `${p}/integrations/${id}`;
		case "app_config":
			return `${p}/app-config`;
		case "test_suite":
			if (suite?.routeId) return `${p}/canvas/${suite.routeId}/test-suites`;
			if (suite?.workflowId) return `${p}/workflow-canvas/${suite.workflowId}/test-suites`;
	}
}
