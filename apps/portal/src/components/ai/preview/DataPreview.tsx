import { useState } from "react";
import { AgentRef } from "../AgentRef";
import type { ToolPart } from "../agentMessages";
import type { RefType } from "../agentRefs";
import { type Data, isRec, oneLine, rec, str } from "./data";
import { ResourceHeader } from "./ResourceHeader";
import { LISTED, META, nameOf, readOf, routeLine } from "./resourceMeta";

const MAX_COLS = 5;
const MAX_ROWS = 20;
/** Columns that say the most about a row, in this order, before the rest. */
const LEAD = ["name", "key", "keyName", "label", "method", "path", "type", "status", "id"];

const isRows = (v: unknown): v is Data[] =>
	Array.isArray(v) && v.length > 0 && v.every((r) => isRec(r));
const isScalar = (v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v);

function columns(rows: Data[]) {
	const keys = [...new Set(rows.slice(0, 20).flatMap((r) => Object.keys(r)))].filter((k) =>
		rows.some((r) => isScalar(r[k]) && r[k] !== ""),
	);
	const rank = (k: string) => (LEAD.includes(k) ? LEAD.indexOf(k) : LEAD.length);
	return keys.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_COLS);
}

/** Rows as a table; the first 20, then a button for the rest. `type`: each row with an id gets a link that opens it. */
function Table({ rows, type }: { rows: Data[]; type?: RefType }) {
	const [all, setAll] = useState(false);
	const cols = columns(rows);
	const shown = all ? rows : rows.slice(0, MAX_ROWS);
	return (
		<div className="overflow-x-auto rounded-md border border-border">
			<table className="w-full text-left text-xs">
				<thead className="bg-surface-secondary text-muted">
					<tr>
						{cols.map((c) => (
							<th key={c} className="px-2 py-1 font-medium">
								{c}
							</th>
						))}
						{type && <th aria-label="Open" />}
					</tr>
				</thead>
				<tbody className="divide-y divide-border">
					{shown.map((r, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: rows keep their order
						<tr key={i}>
							{cols.map((c) => (
								<td key={c} className="max-w-56 truncate px-2 py-1 font-mono text-foreground/80">
									{isScalar(r[c]) ? String(r[c] ?? "") : oneLine(r[c], 60)}
								</td>
							))}
							{type && (
								<td className="px-2 py-1 text-right">
									{r.id !== undefined && (
										<AgentRef type={type} id={str(r.id)} query={nameOf(type, r)}>
											Open
										</AgentRef>
									)}
								</td>
							)}
						</tr>
					))}
				</tbody>
			</table>
			{rows.length > MAX_ROWS && !all && (
				<button
					type="button"
					className="w-full cursor-pointer border-t border-border py-1 text-xs text-muted hover:text-foreground"
					onClick={() => setAll(true)}
				>
					Show all {rows.length}
				</button>
			)}
		</div>
	);
}

/** An object: plain fields as rows, lists of objects as tables under their name, deeper objects the same way (one level more). */
function Fields({ value, depth = 0 }: { value: Data; depth?: number }) {
	const scalars = Object.entries(value).filter(([, v]) => isScalar(v) || !(isRows(v) || isRec(v)));
	const nested = Object.entries(value).filter(([, v]) => isRows(v) || (isRec(v) && depth < 1));
	return (
		<div className="flex flex-col gap-2">
			{scalars.length > 0 && (
				<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
					{scalars.map(([k, v]) => (
						<div key={k} className="contents">
							<dt className="text-muted">{k}</dt>
							<dd className="min-w-0 truncate font-mono text-foreground">{oneLine(v, 160)}</dd>
						</div>
					))}
				</dl>
			)}
			{nested.map(([k, v]) => (
				<section key={k} className="flex flex-col gap-1">
					<h4 className="text-xs font-medium text-muted">{k}</h4>
					{isRows(v) ? <Table rows={v} /> : <Fields value={v as Data} depth={depth + 1} />}
				</section>
			))}
		</div>
	);
}

/** The agent's `list`: one list per type asked for, each row with a link that opens it. */
function Lists({ value }: { value: Data }) {
	return (
		<div className="flex flex-col gap-2">
			{Object.entries(value).map(([key, v]) => {
				const rows = isRec(v) && "items" in v ? v.items : v;
				return (
					<section key={key} className="flex flex-col gap-1">
						<h4 className="text-xs font-medium text-muted">{key}</h4>
						{isRows(rows) ? (
							<Table rows={rows} type={LISTED[key]} />
						) : isRec(v) ? (
							<Fields value={v} />
						) : (
							<p className="text-xs text-muted">None.</p>
						)}
					</section>
				);
			})}
		</div>
	);
}

/** Something a table or a field list can show; a text answer (docs, schemas) is better as Raw. */
export const hasData = (output: unknown) =>
	isRows(output) || (isRec(output) && Object.keys(output).length > 0);

/** get_* / list_*: a compact table or field list instead of JSON; a resource gets a link that opens it. */
export function DataPreview({ tool }: { tool: ToolPart }) {
	const out = tool.output;
	const read = readOf(tool.name, rec(tool.input));
	if (isRows(out)) return <Table rows={out} type={read?.many ? read.type : undefined} />;
	if (!isRec(out)) return null;
	if (tool.name === "list") return <Lists value={out} />;
	if (read?.many && isRows(out.items))
		return (
			<div className="flex flex-col gap-1">
				<Table rows={out.items} type={read.type} />
				{out.hasNext === true && <p className="text-xs text-muted">More on the next page.</p>}
			</div>
		);
	const input = rec(tool.input);
	const id =
		read && !read.many ? str(input[META[read.type].idKey]) || str(input.id) || str(out.id) : "";
	return (
		<div className="flex flex-col gap-2">
			{read && id && (
				<ResourceHeader
					type={read.type}
					id={id}
					name={nameOf(read.type, out)}
					detail={read.type === "route" ? routeLine(out) : undefined}
				/>
			)}
			<Fields value={out} />
		</div>
	);
}
