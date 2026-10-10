import type { ToolPart } from "../agentMessages";
import { isRec, rec, str } from "./data";

type Field = { name: string; type: string; optional?: boolean };

const Fields = ({ fields }: { fields: Field[] }) => (
	<ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs marker:text-muted">
		{fields.map((f) => (
			<li key={f.name}>
				<span className="font-mono text-foreground">{f.name}</span>
				<span className="font-mono text-muted">: {f.type}</span>
				{f.optional && <span className="ml-1.5 text-muted">optional</span>}
			</li>
		))}
	</ul>
);

/** The tables (or collections) of a saved database: just their names, or each one's columns and types. */
export const isSchemaDetails = (output: unknown) =>
	isRec(output) && (Array.isArray(output.tables) || Array.isArray(output.collections));

export function SchemaDetailsPreview({ tool }: { tool: ToolPart }) {
	const out = rec(tool.output);
	const list: unknown[] = (Array.isArray(out.tables) ? out.tables : out.collections) as unknown[];
	if (!list.length) return <p className="text-xs text-muted">Nothing in this database.</p>;
	if (list.every((t) => typeof t === "string"))
		return (
			<ul className="flex list-disc flex-col gap-0.5 pl-4 text-xs marker:text-muted">
				{list.map((t) => (
					<li key={String(t)} className="font-mono text-foreground">
						{String(t)}
					</li>
				))}
			</ul>
		);
	return (
		<div className="flex flex-col gap-3">
			{list.map((t) => {
				const item = rec(t);
				const name = str(item.table) || str(item.collection);
				const cols = (Array.isArray(item.columns) ? item.columns : rec(item).fields) as unknown;
				const fields = (Array.isArray(cols) ? cols : []).map((c) => ({
					name: str(rec(c).name),
					type: str(rec(c).type),
				}));
				return (
					<section key={name} className="flex flex-col gap-1">
						<h4 className="font-mono text-xs font-medium text-foreground">{name}</h4>
						{fields.length ? (
							<Fields fields={fields} />
						) : (
							<p className="text-xs text-muted">No fields found.</p>
						)}
					</section>
				);
			})}
		</div>
	);
}

/**
 * The config fields in the gateway's compact text (`name?: type;` lines inside `{ }`,
 * alternatives joined by `|`), one list per alternative. Only the top-level fields.
 */
export function configFields(config: string): Field[][] {
	const alternatives: Field[][] = [];
	let current: Field[] = [];
	let depth = 0;
	for (const raw of config.split("\n")) {
		const line = raw.trim();
		const m = depth === 1 ? /^(\w+)(\?)?:\s*(.*?);?\s*(?:\/\/.*)?$/.exec(line) : null;
		if (m) current.push({ name: m[1], optional: !!m[2], type: m[3] === "{" ? "object" : m[3] });
		depth += (line.match(/{/g)?.length ?? 0) - (line.match(/}/g)?.length ?? 0);
		if (depth === 0 && line.startsWith("}")) {
			alternatives.push(current);
			current = [];
		}
	}
	return alternatives.filter((a) => a.length);
}

/** The literal a field is fixed to, e.g. `source = "url"`: what tells the alternatives apart. */
const labelOf = (fields: Field[], i: number) => {
	const fixed = fields.find((f) => /^"[^"]*"$/.test(f.type));
	return fixed ? `${fixed.name} = ${fixed.type}` : `Option ${i + 1}`;
};

export const hasConfigFields = (output: unknown) =>
	isRec(output) && typeof output.config === "string" && configFields(output.config).length > 0;

/** get_integration_schema: each config field with its type, and whether it can be left out. Defaults stay in Raw. */
export function IntegrationSchemaPreview({ tool }: { tool: ToolPart }) {
	const alternatives = configFields(str(rec(tool.output).config));
	return (
		<div className="flex flex-col gap-3">
			{alternatives.map((fields, i) => (
				<section key={labelOf(fields, i)} className="flex flex-col gap-1">
					{alternatives.length > 1 && (
						<h4 className="text-xs font-medium text-muted">{labelOf(fields, i)}</h4>
					)}
					<Fields fields={fields} />
				</section>
			))}
		</div>
	);
}
