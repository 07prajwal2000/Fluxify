import {
	BodyEditor,
	Button,
	cn,
	JavaScriptTextArea,
	Label,
	ReorderableList,
} from "@fluxify/components";
import type { SuiteInput } from "@fluxify/server/src/db/schema";
import { type ReactNode, useRef, useState } from "react";
import { TbPlus } from "react-icons/tb";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { PhasePicker } from "./SetupEditor";

export const DEFAULT_INPUT: SuiteInput = { source: "raw", mode: "single", raw: null };

export type SuiteCase = { name: string; input: unknown };

const SCRIPT_TEMPLATE = `// Return the input, or with "Cases" a list: [{ name, input }] or plain values.
// Imports work as in a JS block, e.g. import { faker } from "@faker-js/faker";
return [{ name: "first", input: { id: 1 } }];
`;

const SOURCES: { id: SuiteInput["source"]; label: string }[] = [
	{ id: "raw", label: "Raw data" },
	{ id: "script", label: "Script" },
	{ id: "loader", label: "Loader block" },
];

const pillClass = (active: boolean) =>
	cn(
		"rounded-md px-2 py-1 text-xs font-medium transition-colors",
		active
			? "bg-accent/10 text-accent"
			: "text-muted hover:bg-surface-secondary hover:text-foreground",
	);

const toText = (value: unknown) => (value == null ? "" : JSON.stringify(value, null, 2));

/**
 * One JSON value, edited as text. Invalid text stays local (with an error) and
 * only valid JSON reaches `onChange`. A value changed from outside — a reorder,
 * another suite — replaces the text.
 */
export function JsonField({
	value,
	onChange,
	className = "h-48",
}: {
	value: unknown;
	onChange: (next: unknown) => void;
	className?: string;
}) {
	const [text, setText] = useState(() => toText(value));
	const [error, setError] = useState<string>();
	const committed = useRef(value);
	if (committed.current !== value) {
		committed.current = value;
		setText(toText(value));
		setError(undefined);
	}

	function edit(raw: string) {
		setText(raw);
		try {
			const next = raw.trim() ? JSON.parse(raw) : null;
			committed.current = next;
			setError(undefined);
			onChange(next);
		} catch {
			setError("Invalid JSON; the last valid value is kept");
		}
	}

	return (
		<div className="flex flex-col gap-1">
			<div className={className}>
				<BodyEditor
					contentType="application/json"
					value={{ raw: text, form: {}, formRows: [], binary: "" }}
					onChange={(next) => edit(next.raw)}
					errors={{ bodyError: error }}
				/>
			</div>
			{error && <span className="text-xs text-danger">{error}</span>}
		</div>
	);
}

/**
 * A list of named cases (#486, #487). It does not know what an input looks
 * like: `renderInput` draws the editor for one, the same one Single mode uses.
 */
export function CasesEditor({
	cases,
	onChange,
	renderInput,
}: {
	cases: SuiteCase[];
	onChange: (next: SuiteCase[]) => void;
	renderInput: (value: unknown, onChange: (next: unknown) => void) => ReactNode;
}) {
	const replace = (index: number, next: Partial<SuiteCase>) =>
		onChange(cases.map((item, i) => (i === index ? { ...item, ...next } : item)));

	return (
		<div className="flex flex-col gap-2">
			<ReorderableList
				items={cases}
				showIndex
				showMoveButtons
				onReorder={(next) => onChange(next)}
				onRemove={(_, index) => onChange(cases.filter((_, i) => i !== index))}
				removeButtonAriaLabel="Remove case"
				emptyMessage="No cases yet. Each case runs the workflow once, with the same checks."
				renderItemContent={(item, { index }) => (
					<div className="flex w-full flex-col gap-2 py-1">
						<input
							className="w-full rounded-md border border-border bg-background-secondary px-2 py-1.5 text-xs text-foreground outline-none placeholder:text-muted focus:border-accent"
							placeholder={`Case ${index + 1}`}
							aria-label="Case name"
							value={item.name}
							onChange={(e) => replace(index, { name: e.target.value })}
						/>
						{renderInput(item.input, (input) => replace(index, { input }))}
					</div>
				)}
			/>
			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onPress={() => onChange([...cases, { name: "", input: {} }])}
			>
				<TbPlus size={15} /> Add case
			</Button>
		</div>
	);
}

/**
 * A workflow suite's Input tab (#487): where the input comes from (raw data, a
 * script, a loader block) and whether it is one input or a list of cases.
 */
export function InputEditor({
	projectId,
	input,
	onChange,
}: {
	projectId: string;
	input: SuiteInput;
	onChange: (next: SuiteInput) => void;
}) {
	const { data } = customBlocksQuery.getAll.useQuery(projectId);
	const loaders = (data ?? [])
		.filter((b) => b.testOnly)
		.map((b) => ({ id: b.id, label: b.label || b.name }));
	const set = (next: Partial<SuiteInput>) => onChange({ ...input, ...next });
	const cases = Array.isArray(input.raw) ? (input.raw as SuiteCase[]) : [];

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center gap-4">
				<div className="flex items-center gap-1">
					{SOURCES.map((s) => (
						<button
							key={s.id}
							type="button"
							className={pillClass(input.source === s.id)}
							onClick={() =>
								set({
									source: s.id,
									// what is shown is what gets saved
									...(s.id === "script" && input.script == null && { script: SCRIPT_TEMPLATE }),
								})
							}
						>
							{s.label}
						</button>
					))}
				</div>
				<div className="ml-auto flex items-center gap-1">
					<button
						type="button"
						className={pillClass(input.mode === "single")}
						onClick={() =>
							input.mode !== "single" && set({ mode: "single", raw: cases[0]?.input ?? null })
						}
					>
						Single input
					</button>
					<button
						type="button"
						className={pillClass(input.mode === "cases")}
						onClick={() =>
							input.mode !== "cases" &&
							set({ mode: "cases", raw: input.raw == null ? [] : [{ name: "", input: input.raw }] })
						}
					>
						Cases
					</button>
				</div>
			</div>

			<p className="text-xs text-muted">
				{input.mode === "single"
					? "The workflow runs once. A list is a batch, like a trigger delivers: [d1] is one item, [d1, d2] a bulk run of two."
					: "The workflow runs once per case, one after another, and every case gets the same checks."}{" "}
				The trigger is skipped: the input goes straight to the workflow.
			</p>

			{input.source === "raw" &&
				(input.mode === "single" ? (
					<div>
						<Label>Input</Label>
						<JsonField value={input.raw} onChange={(raw) => set({ raw })} className="h-72" />
					</div>
				) : (
					<CasesEditor
						cases={cases}
						onChange={(raw) => set({ raw })}
						renderInput={(value, change) => <JsonField value={value} onChange={change} />}
					/>
				))}

			{input.source === "script" && (
				<div className="flex flex-col gap-1">
					<Label>Script</Label>
					<JavaScriptTextArea
						rows={12}
						value={input.script ?? ""}
						onChange={(script) => set({ script })}
					/>
					<span className="text-xs text-muted">
						Runs once before the cases, like a JS block: project npm packages can be imported.
					</span>
				</div>
			)}

			{input.source === "loader" && (
				<PhasePicker
					label="Loader block"
					help="A test-only custom block that returns the input, or with Cases the list of cases. It runs once, after setup."
					blocks={loaders}
					blockId={input.loaderBlockId ?? null}
					timeoutMs={input.timeoutMs ?? 30_000}
					onChange={({ blockId, timeoutMs }) => set({ loaderBlockId: blockId, timeoutMs })}
				/>
			)}
		</div>
	);
}
