import { useEffect, useRef, useState } from "react";
import { Button, DeleteIconButton, Input, Label } from "@fluxify/components";
import { TbPlus } from "react-icons/tb";
import { AppConfigSelector } from "./AppConfigSelector";

type Row = [name: string, value: string];

const toRows = (headers?: Record<string, string>): Row[] => Object.entries(headers ?? {});

type Props = {
	projectId: string;
	value?: Record<string, string>;
	onChange: (headers: Record<string, string>) => void;
	description?: string;
};

// Extra request headers. The value is a literal or an app-config reference, so a
// token can live in app config instead of the integration row.
export function HeadersEditor({ projectId, value, onChange, description }: Props) {
	const [rows, setRows] = useState<Row[]>(() => toRows(value));
	// Rows hold what the map cannot — a row whose name is not typed yet — so they
	// are only rebuilt when the map changes from outside (edit mode hydrating),
	// never from this editor's own change echoing back.
	const emitted = useRef(JSON.stringify(value ?? {}));
	useEffect(() => {
		const incoming = JSON.stringify(value ?? {});
		if (incoming === emitted.current) return;
		emitted.current = incoming;
		setRows(toRows(value));
	}, [value]);

	function update(next: Row[]) {
		setRows(next);
		const headers = Object.fromEntries(next.filter(([name]) => name.trim()));
		emitted.current = JSON.stringify(headers);
		onChange(headers);
	}

	const setRow = (index: number, row: Row) => update(rows.map((r, i) => (i === index ? row : r)));

	return (
		<div className="flex flex-col gap-2">
			<div className="flex flex-col gap-1">
				<Label>Headers</Label>
				{description && <span className="text-xs text-muted">{description}</span>}
			</div>
			{rows.map(([name, headerValue], index) => (
				<div key={index} className="flex items-center gap-2">
					<Input
						className="w-2/5"
						value={name}
						onChange={(e) => setRow(index, [e.currentTarget.value, headerValue])}
						placeholder="X-Api-Key"
						aria-label="Header name"
					/>
					<AppConfigSelector
						projectId={projectId}
						value={headerValue}
						onChange={(v) => setRow(index, [name, v])}
						placeholder="value"
					/>
					<DeleteIconButton
						aria-label="Remove header"
						onPress={() => update(rows.filter((_, i) => i !== index))}
					/>
				</div>
			))}
			<Button size="sm" variant="secondary" className="self-start" onPress={() => update([...rows, ["", ""]])}>
				<TbPlus size={14} /> Add header
			</Button>
		</div>
	);
}
