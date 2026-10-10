import { isRefType, type RefType } from "../agentRefs";
import { type Data, str } from "./data";

type Meta = {
	/** The tool input field that holds the resource's id (an update has it; a create does not). */
	idKey: string;
	/** Fields that name it, first one found wins. */
	names: string[];
	/** The fields worth showing first. */
	fields: string[];
};

export const META: Record<RefType, Meta> = {
	route: { idKey: "routeId", names: ["name", "path"], fields: ["active", "description"] },
	workflow: { idKey: "workflowId", names: ["name"], fields: ["active", "description"] },
	trigger: {
		idKey: "triggerId",
		names: ["name"],
		fields: ["type", "schedule", "workflowId", "source"],
	},
	custom_block: {
		idKey: "customBlockId",
		names: ["label", "name"],
		fields: ["usage", "description"],
	},
	middleware: { idKey: "middlewareId", names: ["name"], fields: ["description"] },
	integration: { idKey: "integrationId", names: ["name"], fields: ["group", "variant"] },
	app_config: {
		idKey: "appConfigId",
		names: ["keyName"],
		fields: ["value", "description", "isEncrypted"],
	},
	test_suite: { idKey: "testSuiteId", names: ["name"], fields: ["targetType", "targetId"] },
};

/** `save_route` → route + save; anything that is not a save or delete of a resource → nothing. */
export function resourceOf(tool: string) {
	const m = /^(save|delete)_(.+)$/.exec(tool);
	return m && isRefType(m[2]) ? { verb: m[1] as "save" | "delete", type: m[2] } : undefined;
}

/** Fields that say which resource, not what about it: never a change. */
export const isOwnId = (type: RefType, field: string) =>
	field === "projectId" || field === META[type].idKey;

export const nameOf = (type: RefType, ...sources: Data[]) =>
	META[type].names.map((k) => sources.map((s) => str(s[k])).find(Boolean)).find(Boolean) ?? "";

/** A route is best told as its method and path. */
export const routeLine = (d: Data) => [str(d.method), str(d.path)].filter(Boolean).join(" ");

/** An encrypted app config entry's value is a secret whatever the field is called. */
export const secretFields = (type: RefType, ...sources: Data[]) =>
	new Set(type === "app_config" && sources.some((s) => s.isEncrypted === true) ? ["value"] : []);

/** `get_route` → route, one; `list_routes` → route, many. Any other read has no resource page. */
const READS: Record<string, RefType> = {
	routes: "route",
	workflows: "workflow",
	triggers: "trigger",
	custom_blocks: "custom_block",
	middlewares: "middleware",
	integrations: "integration",
	app_config: "app_config",
	test_suites: "test_suite",
};
export function readOf(tool: string) {
	const m = /^(get|list)_(.+)$/.exec(tool);
	if (!m) return undefined;
	if (m[1] === "list") return READS[m[2]] && { type: READS[m[2]], many: true };
	const type = Object.values(READS).find((t) => t === m[2]);
	return type && { type, many: false };
}
