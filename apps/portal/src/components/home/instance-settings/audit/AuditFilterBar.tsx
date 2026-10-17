import { Button, CustomSelect, Input, TextField } from "@fluxify/components";
import { useEffect, useState } from "react";
import type { AuditFilterOptions, AuditFilters } from "@/services/auditLogs";
import { SOURCE_OPTIONS } from "./auditLabels";

const ANY = "__any__";
const TYPING_DELAY_MS = 400;

const withAny = (label: string, values: { value: string; label: string }[]) => [
	{ value: ANY, label },
	...values,
];

/** Text that reaches the filters only after the user stops typing, so each key is not a request. */
function useTypedFilter(value: string | undefined, commit: (value: string | undefined) => void) {
	const [draft, setDraft] = useState(value ?? "");
	// the filters were cleared or set from elsewhere
	useEffect(() => setDraft(value ?? ""), [value]);
	useEffect(() => {
		if (draft === (value ?? "")) return;
		const timer = setTimeout(() => commit(draft.trim() || undefined), TYPING_DELAY_MS);
		return () => clearTimeout(timer);
	}, [draft, value, commit]);
	return [draft, setDraft] as const;
}

export function AuditFilterBar({
	filters,
	options,
	onChange,
	onClear,
}: {
	filters: AuditFilters;
	options: AuditFilterOptions | undefined;
	onChange: (patch: Partial<AuditFilters>) => void;
	onClear: () => void;
}) {
	const [actor, setActor] = useTypedFilter(filters.actorEmail, (actorEmail) =>
		onChange({ actorEmail }),
	);
	const [resourceId, setResourceId] = useTypedFilter(filters.resourceId, (value) =>
		onChange({ resourceId: value }),
	);

	const projects = options?.projects ?? [];
	// a project id in the URL that has no events is still shown, not silently dropped
	const known = projects.some((p) => p.id === filters.projectId);
	const projectOptions = withAny("All projects", [
		...projects.map((p) => ({
			value: p.id,
			label: `${p.name || p.slug || p.id}${p.deleted ? " (deleted)" : ""}`,
		})),
		...(filters.projectId && !known
			? [{ value: filters.projectId, label: filters.projectId }]
			: []),
	]);
	const asOptions = (values: string[] | undefined) =>
		(values ?? []).map((v) => ({ value: v, label: v }));
	const active = Object.values(filters).some(Boolean);

	return (
		<form
			role="search"
			aria-label="Audit log filters"
			onSubmit={(e) => e.preventDefault()}
			className="flex flex-wrap items-end gap-3"
		>
			<div className="w-52">
				<CustomSelect
					aria-label="Project"
					options={projectOptions}
					value={filters.projectId ?? ANY}
					onChange={(v) => onChange({ projectId: v === ANY ? undefined : v })}
				/>
			</div>
			<div className="w-48">
				<CustomSelect
					aria-label="Resource type"
					options={withAny("All resources", asOptions(options?.resourceTypes))}
					value={filters.resourceType ?? ANY}
					onChange={(v) => onChange({ resourceType: v === ANY ? undefined : v })}
				/>
			</div>
			<div className="w-40">
				<CustomSelect
					aria-label="Action"
					options={withAny("All actions", asOptions(options?.actions))}
					value={filters.action ?? ANY}
					onChange={(v) => onChange({ action: v === ANY ? undefined : v })}
				/>
			</div>
			<div className="w-56">
				<CustomSelect
					aria-label="Source"
					options={withAny("All sources", SOURCE_OPTIONS)}
					value={filters.source ?? ANY}
					onChange={(v) =>
						onChange({ source: v === ANY ? undefined : (v as AuditFilters["source"]) })
					}
				/>
			</div>
			<TextField aria-label="Actor email" value={actor} onChange={setActor} className="w-52">
				<Input placeholder="Who (email)" />
			</TextField>
			<TextField
				aria-label="Resource id"
				value={resourceId}
				onChange={setResourceId}
				className="w-44"
			>
				<Input placeholder="Resource id" />
			</TextField>
			<TextField
				aria-label="From date"
				type="date"
				value={filters.from ?? ""}
				onChange={(from) => onChange({ from: from || undefined })}
				className="w-40"
			>
				<Input />
			</TextField>
			<TextField
				aria-label="To date"
				type="date"
				value={filters.to ?? ""}
				onChange={(to) => onChange({ to: to || undefined })}
				className="w-40"
			>
				<Input />
			</TextField>
			{active && (
				<Button variant="ghost" onPress={onClear}>
					Clear filters
				</Button>
			)}
		</form>
	);
}
