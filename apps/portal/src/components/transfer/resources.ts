import type { CanvasDiff } from "@/components/ai/preview/canvasDiff";
import type {
	ImportConflicts,
	ResourceType,
	RouteBundle,
	WorkflowBundle,
} from "@/services/transfer";

export type FieldKey = "name" | "path";

/** What the import dialog needs to know about one kind of exportable resource. */
export type TransferResource<B> = {
	/** lower case, read into the copy: "Import this route?" */
	label: string;
	/** what the export contains, for the export dialog */
	contents: string;
	/** the fields the user can change before importing */
	fields: { key: FieldKey; label: string; mono?: boolean }[];
	isBundle(raw: unknown): raw is B;
	read(bundle: B): Partial<Record<FieldKey, string>>;
	write(bundle: B, values: Partial<Record<FieldKey, string>>): B;
	/** a copy's value for a field that is already taken */
	copy: Partial<Record<FieldKey, (value: string) => string>>;
	describeTaken(bundle: B, key: FieldKey): string;
};

export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** `Get users` → `Get users-copy` */
export const copyName = (name: string) => `${name}-copy`;

/**
 * A path the copy can take next to the original: `/users` → `/users-copy`. A
 * path that ends in a param (or a slash) gets a segment instead, because
 * `:id-copy` would read as one oddly named param.
 */
export function copyPath(path: string): string {
	const base = path.replace(/\/+$/, "");
	if (base === "" || base.split("/").pop()?.startsWith(":")) return `${base}/copy`;
	return `${base}-copy`;
}

const hasCanvas = (b: { canvas?: { blocks?: unknown; edges?: unknown } }) =>
	Array.isArray(b.canvas?.blocks) && Array.isArray(b.canvas?.edges);

const route: TransferResource<RouteBundle> = {
	label: "route",
	contents: "settings, blocks and response schemas",
	fields: [
		{ key: "name", label: "Name" },
		{ key: "path", label: "Path", mono: true },
	],
	isBundle: (raw): raw is RouteBundle => {
		const b = raw as Partial<RouteBundle> | undefined;
		return (
			b?.kind === "fluxify.route" &&
			typeof b.route?.name === "string" &&
			typeof b.route?.path === "string" &&
			hasCanvas(b)
		);
	},
	read: (b) => ({ name: b.route.name, path: b.route.path }),
	write: (b, v) => ({ ...b, route: { ...b.route, ...v } }),
	copy: { name: copyName, path: copyPath },
	describeTaken: (b, key) =>
		key === "name" ? `a route named "${b.route.name}"` : `${b.route.method} ${b.route.path}`,
};

const workflow: TransferResource<WorkflowBundle> = {
	label: "workflow",
	contents: "settings and blocks",
	fields: [{ key: "name", label: "Name" }],
	isBundle: (raw): raw is WorkflowBundle => {
		const b = raw as Partial<WorkflowBundle> | undefined;
		return b?.kind === "fluxify.workflow" && typeof b.workflow?.name === "string" && hasCanvas(b);
	},
	read: (b) => ({ name: b.workflow.name }),
	write: (b, v) => ({ ...b, workflow: { ...b.workflow, ...(v.name ? { name: v.name } : {}) } }),
	copy: { name: copyName },
	describeTaken: (b) => `a workflow named "${b.workflow.name}"`,
};

export const TRANSFER_RESOURCES: {
	route: TransferResource<RouteBundle>;
	workflow: TransferResource<WorkflowBundle>;
} = { route, workflow };

export type AnyResource = TransferResource<RouteBundle | WorkflowBundle>;
/** the pair of a type and its resource, for code generic over both */
export const resourceOf = (type: ResourceType) => TRANSFER_RESOURCES[type] as AnyResource;

/**
 * What the confirmation starts with. What is already taken in the project gets
 * a "-copy"; what is free stays as exported. The user can change any of it.
 */
export function importDefaults<B>(
	resource: TransferResource<B>,
	bundle: B,
	taken: ImportConflicts["taken"],
): Partial<Record<FieldKey, string>> {
	const values = resource.read(bundle);
	for (const key of taken) {
		const value = values[key];
		const copy = resource.copy[key];
		if (value !== undefined && copy) values[key] = copy(value);
	}
	return values;
}

/** The warning under the fields: what already exists, and that it was renamed as a copy. */
export function conflictNotice<B>(
	resource: TransferResource<B>,
	bundle: B,
	taken: ImportConflicts["taken"],
): string | undefined {
	const found = taken.map((key) => resource.describeTaken(bundle, key));
	if (found.length === 0) return undefined;
	return `${found.join(" and ")} already exist${found.length === 1 ? "s" : ""} in this project. It will be imported as a copy, or rename it as you like.`;
}

/** The bundle's canvas as the read-only canvas draws it: every block as it is. */
export function previewCanvas(bundle: RouteBundle | WorkflowBundle): CanvasDiff {
	return {
		blocks: bundle.canvas.blocks.map((b) => ({
			key: b.id,
			type: b.type,
			status: "same",
			position: b.position,
			data: (b.data ?? {}) as Record<string, unknown>,
			changes: [],
		})),
		edges: bundle.canvas.edges.map((e) => ({
			id: e.id,
			from: e.from,
			to: e.to,
			// handle ids are `<block>-<handle>`; the canvas wants the handle's own name
			handle: e.fromHandle?.startsWith(`${e.from}-`)
				? e.fromHandle.slice(e.from.length + 1)
				: "source",
			status: "same",
		})),
	};
}
