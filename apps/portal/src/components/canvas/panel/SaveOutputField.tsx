import { RESERVED_WORDS, variableNameError } from "@fluxify/blocks/variableName";
import {
	buildCanvasVariableSnippets,
	Checkbox,
	Description,
	FieldError,
	Input,
	Label,
	TextField,
	useCanvasVariableTypes,
	useRegisterSnippets,
} from "@fluxify/components";
import { useNodes, useReactFlow } from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import { blockLabels } from "../blocks/blockLabels";
import { BLOCK_TYPES } from "../blocks/blockTypes";
import { useCanvasChanges } from "../changes/ChangesContext";
import type { BlockData, BlockNode } from "../types";

type SaveAsVariable = { enabled: boolean; name: string };

/** Built-in blocks whose output is worth keeping. */
const DATA_BLOCKS = new Set<string>([
	BLOCK_TYPES.httprequest,
	BLOCK_TYPES.transformer,
	BLOCK_TYPES.arrayops,
	BLOCK_TYPES.db_getsingle,
	BLOCK_TYPES.db_exists,
	BLOCK_TYPES.db_count,
	BLOCK_TYPES.db_getall,
	BLOCK_TYPES.db_insert,
	BLOCK_TYPES.db_insertbulk,
	BLOCK_TYPES.db_update,
	BLOCK_TYPES.db_delete,
	BLOCK_TYPES.db_native,
	BLOCK_TYPES.db_transaction,
	BLOCK_TYPES.kv_raw,
	BLOCK_TYPES.kv_operations,
	BLOCK_TYPES.orchestrator,
]);

const BUILTIN_TYPES = new Set<string>(Object.values(BLOCK_TYPES));

export function savesOutput(type: string | undefined, data: BlockData): boolean {
	if (!type) return false;
	if (DATA_BLOCKS.has(type)) return true;
	// a custom block run async or queued passes its input on, not a result
	return !BUILTIN_TYPES.has(type) && (data.invoke ?? "sync") === "sync";
}

/**
 * Keeps only what a JS identifier may hold: letters, digits, `_` and `$`, and
 * no leading digit. Applied on every change, so invalid input never appears.
 */
export function sanitizeVariableName(raw: string): string {
	return raw.replace(/[^A-Za-z0-9_$]/g, "").replace(/^[0-9]+/, "");
}

function readSetting(data: BlockData | undefined): SaveAsVariable {
	const setting = data?.saveAsVariable as Partial<SaveAsVariable> | undefined;
	return {
		enabled: setting?.enabled === true,
		name: typeof setting?.name === "string" ? setting.name : "",
	};
}

/**
 * Variables written on the canvas — Set Var keys (globals) plus saved block
 * outputs (under `outputs`) — each with the label of the block writing it.
 */
export function canvasVariables(
	blocks: { type?: string; data?: unknown }[],
): { name: string; source: string; output?: true }[] {
	return blocks
		.map((b) => {
			const data = b.data as BlockData | undefined;
			const source = blockLabels(b.type ?? "", data).name;
			if (b.type === BLOCK_TYPES.setvar) return { name: String(data?.key ?? "").trim(), source };
			const setting = readSetting(data);
			const saved = setting.enabled && savesOutput(b.type, data ?? {});
			return { name: saved ? setting.name.trim() : "", source, output: true as const };
		})
		.filter((variable) => variable.name);
}

/**
 * Registers a snippet per canvas variable. Reads the live nodes, so renaming a
 * block or its variable updates the snippet without a save.
 */
export function CanvasVariableSnippets() {
	const variables = canvasVariables(useNodes());
	const key = JSON.stringify(variables);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const snippets = useMemo(() => buildCanvasVariableSnippets(variables), [key]);
	useRegisterSnippets(snippets);
	// a Set Var key that is a reserved word, declared as a global, would break
	// every other declaration; saved outputs are members of `outputs`, so fine
	useCanvasVariableTypes(
		variables.filter((v) => (v.output ? !variableNameError(v.name) : !RESERVED_WORDS.has(v.name))),
	);
	return null;
}

/** "Save output to variable" toggle and name, shown under General. */
export function SaveOutputField({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const setting = readSetting(block.data);
	const [name, setName] = useState(setting.name);

	useEffect(() => setName(setting.name), [setting.name]);

	const save = (next: Partial<SaveAsVariable>) =>
		updateNodeData(block.id, { saveAsVariable: { ...setting, ...next } });
	// only an empty name is left to report; the rest is stripped as you type
	const error = variableNameError(name.trim());

	return (
		<div className="flex flex-col gap-3">
			<Checkbox
				checked={setting.enabled}
				isDisabled={!editable}
				label="Save output to variable"
				description="Also store this block's output in outputs.<name> for later blocks in this request"
				onChange={(enabled) => save({ enabled })}
			/>
			{setting.enabled && (
				<TextField
					fullWidth
					variant="secondary"
					isDisabled={!editable}
					value={name}
					isInvalid={Boolean(error)}
					onChange={(next) => setName(sanitizeVariableName(next))}
				>
					<Label>Variable Name</Label>
					<Input
						placeholder="e.g. users"
						onBlur={() => !error && name !== setting.name && save({ name })}
						onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
					/>
					{error ? (
						<FieldError>{error}</FieldError>
					) : (
						<Description>Letters, digits, _ and $ only. Cannot start with a digit.</Description>
					)}
				</TextField>
			)}
		</div>
	);
}
