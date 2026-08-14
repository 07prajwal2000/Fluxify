import { Button, DeleteIconButton, Description, JsTextField, Label } from "@fluxify/components";
import { useReactFlow } from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { TbMinus, TbPlus } from "react-icons/tb";
import { useCanvasChanges } from "../../changes/ChangesContext";
import { BlockSettings } from "../BlockSettings";
import {
	BlockCheckboxField,
	BlockJsTextField,
	BlockSelectField,
} from "../fields";
import type { BlockNode } from "../../types";

const METHOD_OPTIONS = [
	{ value: "GET", label: "GET" },
	{ value: "POST", label: "POST" },
	{ value: "PUT", label: "PUT" },
	{ value: "DELETE", label: "DELETE" },
	{ value: "PATCH", label: "PATCH" },
];

function HeadersEditor({
	headers,
	editable,
	onChange,
}: {
	headers: Record<string, string>;
	editable: boolean;
	onChange: (next: Record<string, string>) => void;
}) {
	const [entries, setEntries] = useState<[string, string][]>(() =>
		Object.entries(headers || {}),
	);

	const lastEmittedRef = useRef<string>("");

	useEffect(() => {
		const incoming = JSON.stringify(headers || {});
		if (lastEmittedRef.current !== incoming) {
			setEntries(Object.entries(headers || {}));
		}
	}, [headers]);

	const emit = useCallback(
		(next: [string, string][]) => {
			const map: Record<string, string> = {};
			for (const [k, v] of next) {
				if (k.trim() !== "") {
					map[k] = v;
				}
			}
			lastEmittedRef.current = JSON.stringify(map);
			onChange(map);
		},
		[onChange],
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
							placeholder="Header Name"
							value={key}
							onChange={(nextKey) => handleKeyChange(index, nextKey)}
						/>
					</div>
					<div className="flex-1 min-w-0">
						<JsTextField
							fullWidth
							variant="secondary"
							isDisabled={!editable}
							placeholder="Header Value"
							value={val}
							onChange={(nextVal) => handleValueChange(index, nextVal)}
						/>
					</div>
					<DeleteIconButton
						aria-label="Remove header"
						icon={<TbMinus className="size-4" />}
						isDisabled={!editable}
						size="sm"
						onPress={() => handleRemove(index)}
					/>
				</div>
			))}

			{entries.length === 0 && (
				<div className="text-xs text-muted py-2 text-center border border-dashed border-[var(--border,#27272a)] rounded-md">
					No headers configured
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
					<TbPlus className="size-4 mr-1" /> Add Header
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
