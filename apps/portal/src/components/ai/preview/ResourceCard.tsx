import type { ToolPart } from "../agentMessages";
import { fieldChanges } from "./canvasDiff";
import { type Data, rec, str } from "./data";
import { FieldDiff } from "./FieldDiff";
import { KeyFields } from "./KeyFields";
import { Notice } from "./Notice";
import { ResourceHeader } from "./ResourceHeader";
import { isOwnId, META, nameOf, resourceOf, routeLine, secretFields } from "./resourceMeta";
import { useCurrent } from "./useCurrent";

const added = (data: Data) => Object.entries(data).map(([field, after]) => ({ field, after }));

/**
 * A save_* call as a card: what it is, its key fields, and either "New" with
 * every field or, for an update, the fields that differ from what is saved now.
 */
export function ResourceCard({ tool, asking }: { tool: ToolPart; asking: boolean }) {
	const res = resourceOf(tool.name);
	const input = rec(tool.input);
	const type = res?.type ?? "route";
	const id = str(input[META[type].idKey]);
	const update = id !== "";
	const { current, loading, failed } = useCurrent(tool.name, input, asking && update);
	if (!res) return null;
	const fields = Object.fromEntries(Object.entries(input).filter(([k]) => !isOwnId(type, k)));
	const secrets = secretFields(type, fields, current ?? {});
	const before = Object.fromEntries(
		Object.keys(fields)
			.filter((k) => current && k in current)
			.map((k) => [k, (current as Data)[k]]),
	);
	const changes = asking && update && current ? fieldChanges(before, fields) : added(fields);
	return (
		<section className="flex flex-col gap-2" aria-label={`${update ? "Update" : "New"} ${type}`}>
			<ResourceHeader
				type={type}
				name={nameOf(type, fields, current ?? {})}
				detail={type === "route" ? routeLine({ ...current, ...fields }) : undefined}
				id={id || str(rec(tool.output).id)}
				badge={update ? "update" : "new"}
			/>
			<KeyFields type={type} data={{ ...current, ...fields }} />
			{asking && update && loading && (
				<div className="h-12 animate-pulse rounded-lg bg-surface-secondary" aria-busy />
			)}
			{asking && update && failed && (
				<Notice tone="warning">Could not read the saved version, so all fields show as set.</Notice>
			)}
			{asking && update && current && !changes.length ? (
				<p className="text-xs text-muted">Nothing differs from what is saved.</p>
			) : (
				<FieldDiff changes={changes} secrets={secrets} />
			)}
		</section>
	);
}
