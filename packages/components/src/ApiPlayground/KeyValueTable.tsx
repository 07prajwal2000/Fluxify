import { TbPlus } from "react-icons/tb";
import { Button, Input } from "@heroui/react";
import { DeleteIconButton } from "../DeleteButton";
import type { ApiKeyValue } from "./types";

type KeyValueTableProps = {
	rows: ApiKeyValue[];
	onChange: (rows: ApiKeyValue[]) => void;
	onAdd?: () => void;
	addLabel: string;
	readOnlyKeys?: boolean;
};

export function KeyValueTable({ rows, onChange, onAdd, addLabel, readOnlyKeys }: KeyValueTableProps) {
	function update(id: string, field: "key" | "value", value: string) {
		onChange(rows.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
	}

	return (
		<div className="space-y-1.5">
			<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] gap-2 px-1 text-[10px] font-medium uppercase tracking-wider text-muted">
				<span>Key</span><span>Value</span><span />
			</div>
			{rows.map((row) => (
				<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] gap-2" key={row.id}>
					<Input aria-label={`${row.key || "Parameter"} key`} readOnly={readOnlyKeys} value={row.key} onChange={(event) => update(row.id, "key", event.target.value)} className="h-8 min-w-0 font-mono text-xs" />
					<Input aria-label={`${row.key || "Parameter"} value`} value={row.value} onChange={(event) => update(row.id, "value", event.target.value)} className="h-8 min-w-0 font-mono text-xs" />
					{!row.required ? <DeleteIconButton aria-label={`Remove ${row.key || "row"}`} size="sm" iconSize={15} onPress={() => onChange(rows.filter((candidate) => candidate.id !== row.id))} /> : <span />}
				</div>
			))}
			{onAdd && <Button size="sm" variant="secondary" onPress={onAdd}><TbPlus size={14} />{addLabel}</Button>}
		</div>
	);
}
