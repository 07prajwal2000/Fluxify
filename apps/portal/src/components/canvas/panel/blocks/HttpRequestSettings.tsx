import { Button, DeleteIconButton, Description, JsTextField, Label } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { TbMinus, TbPlus } from "react-icons/tb";
import { useCanvasChanges } from "../../changes/ChangesContext";
import type { BlockNode } from "../../types";
import { BlockSettings } from "../BlockSettings";
import { BlockCheckboxField, BlockJsTextField, BlockSelectField } from "../fields";

const METHOD_OPTIONS = [
	{ value: "GET", label: "GET" },
	{ value: "POST", label: "POST" },
	{ value: "PUT", label: "PUT" },
	{ value: "DELETE", label: "DELETE" },
	{ value: "PATCH", label: "PATCH" },
];

/** why the rows cannot be saved: a value without a key, or a key twice once trimmed */
export function keyRowsProblem(rows: [string, unknown][]) {
	const seen = new Set<string>();
	for (const [raw, value] of rows) {
		const key = raw.trim();
		if (!key && value !== "" && value != null) return "Every value needs a key.";
		if (key && seen.has(key)) return `The key '${key}' is used twice.`;
		seen.add(key);
	}
}

/**
 * A name/value list; `noun` names a row (SQS calls them message attributes).
 * With `strictKeys`, rows with a missing or repeated key are refused with a
 * message and nothing is saved until they are fixed.
 */
export function HeadersEditor({
	headers,
	editable,
	onChange,
	noun = "Header",
	keyPlaceholder = `${noun} Name`,
	strictKeys = false,
}: {
	headers: Record<string, string>;
	editable: boolean;
	onChange: (next: Record<string, string>) => void;
	noun?: string;
	keyPlaceholder?: string;
	strictKeys?: boolean;
}) {
	const [entries, setEntries] = useState<[string, string][]>(() => Object.entries(headers || {}));
	const [problem, setProblem] = useState<string>();

	const lastEmittedRef = useRef<string>("");

	useEffect(() => {
		const incoming = JSON.stringify(headers || {});
		if (lastEmittedRef.current !== incoming) {
			setEntries(Object.entries(headers || {}));
		}
	}, [headers]);

	const emit = useCallback(
		(next: [string, string][]) => {
			const invalid = strictKeys ? keyRowsProblem(next) : undefined;
			setProblem(invalid);
			if (invalid) return;
			const map: Record<string, string> = {};
			for (const [k, v] of next) {
				if (k.trim() !== "") {
					map[k] = v;
				}
			}
			lastEmittedRef.current = JSON.stringify(map);
			onChange(map);
		},
		[onChange, strictKeys],
	);

	const handleKeyChange = (index: number, key: string) => {
		const next: [string, string][] = entries.map((item, i) =>
			i === index ? [key, item[1]] : [...item],
		);
		setEntries(next);
		emit(next);
	};

	const handleValueChange = (index: number, value: string) => {
		const next: [string, string][] = entries.map((item, i) =>
			i === index ? [item[0], value] : [...item],
		);
		setEntries(next);
		emit(next);
	};

	const handleAdd = () => {
		const next: [string, string][] = [...entries, ["", ""]];
		setEntries(next);
		emit(next);
	};

	const handleRemove = (index: number) => {
		const next = entries.filter((_, i) => i !== index);
		setEntries(next);
		emit(next);
	};

	return (
		<div className="flex flex-col gap-2.5 w-full">
			{entries.map(([key, val], index) => (
				<div key={index} className="flex items-center gap-2 w-full">
					<div className="flex-1 min-w-0">
						<JsTextField
							fullWidth
							variant="secondary"
							isDisabled={!editable}
							placeholder={keyPlaceholder}
							value={key}
							onChange={(nextKey) => handleKeyChange(index, nextKey)}
						/>
					</div>
					<div className="flex-1 min-w-0">
						<JsTextField
							fullWidth
							variant="secondary"
							isDisabled={!editable}
							placeholder={`${noun} Value`}
							value={val}
							onChange={(nextVal) => handleValueChange(index, nextVal)}
						/>
					</div>
					<DeleteIconButton
						aria-label={`Remove ${noun.toLowerCase()}`}
						icon={<TbMinus className="size-4" />}
						isDisabled={!editable}
						size="sm"
						onPress={() => handleRemove(index)}
					/>
				</div>
			))}

			{problem && (
				<p role="alert" className="text-xs text-danger">
					{problem}
				</p>
			)}

			{entries.length === 0 && (
				<div className="text-xs text-muted py-2 text-center border border-dashed border-border rounded-md">
					No {noun.toLowerCase()}s configured
				</div>
			)}

			<div>
				<Button
					isDisabled={!editable}
					size="sm"
					variant="secondary"
					className="mt-1"
					onPress={handleAdd}
				>
					<TbPlus className="size-4 mr-1" /> Add {noun}
				</Button>
			</div>
		</div>
	);
}

/** HTTP Request General tab: method and target url */
export function HttpRequestGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="method"
				label="Method"
				options={METHOD_OPTIONS}
				placeholder="Method"
				hint="HTTP method for the request."
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="url"
				label="URL"
				placeholder="https://api.example.com/data"
				hint="URL to make the request to (supports js: expression)."
			/>
		</div>
	);
}

/** HTTP Request Headers tab: custom headers editor */
export function HttpRequestHeadersSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const headers =
		typeof block.data.headers === "object" && block.data.headers !== null
			? (block.data.headers as Record<string, string>)
			: {};

	return (
		<div className="flex flex-col gap-3 w-full">
			<Description className="text-xs text-muted">
				Configure custom headers sent with the HTTP request.
			</Description>
			<HeadersEditor
				headers={headers}
				editable={editable}
				onChange={(next) => updateNodeData(block.id, { headers: next })}
			/>
		</div>
	);
}

/** HTTP Request Body tab: useParam toggle and request body editor */
export function HttpRequestBodySettings({ block }: { block: BlockNode }) {
	const useParam = Boolean(block.data.useParam);

	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockCheckboxField
				blockId={block.id}
				data={block.data}
				name="useParam"
				label="Use Params"
				description="Use previous block output as request body"
			/>

			{!useParam && (
				<BlockJsTextField
					blockId={block.id}
					data={block.data}
					name="body"
					label="Request Body"
					placeholder='{ "key": "value" }'
					hint="Body to pass to the request. Can be JSON string or JS expression."
				/>
			)}
		</div>
	);
}

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

export function httpRequestSettings(block: BlockNode) {
	const method = String(block.data.method || "GET").toUpperCase();
	const hasBody = BODY_METHODS.has(method);

	const tabs = [
		<BlockSettings.TabHead key="general" name="General">
			<HttpRequestGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="headers" name="Headers">
			<HttpRequestHeadersSettings block={block} />
		</BlockSettings.TabHead>,
	];

	if (hasBody) {
		tabs.push(
			<BlockSettings.TabHead key="body" name="Body">
				<HttpRequestBodySettings block={block} />
			</BlockSettings.TabHead>,
		);
	}

	return tabs;
}
