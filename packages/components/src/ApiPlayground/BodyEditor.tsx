import { Button, Input } from "@heroui/react";
import Editor from "@monaco-editor/react";
import clsx from "clsx";
import { useState } from "react";
import { TbFile, TbLetterCase, TbPlus } from "react-icons/tb";
import { DeleteIconButton } from "../DeleteButton";
import { FilePicker } from "./FilePicker";
import { SchemaForm } from "./SchemaForm";
import type { ApiFormRow, ApiRequestBody, ApiSchema } from "./types";
import { base64ToBlob, createRow, isFormContentType, schemaProperties } from "./utils";

type BodyEditorProps = {
	contentType: string;
	/** Declared form fields become a fixed form; without them fields are typed in by hand. */
	schema?: ApiSchema | null;
	value: ApiRequestBody;
	onChange: (value: ApiRequestBody) => void;
	errors?: { bodyError?: string; formFields?: Record<string, string> };
};

/** The body for one request, edited in the shape its content type needs. */
export function BodyEditor({ contentType, schema, value, onChange, errors }: BodyEditorProps) {
	if (isFormContentType(contentType)) {
		return schemaProperties(schema).length > 0 ? (
			<SchemaForm
				schema={schema}
				value={value.form}
				onChange={(form) => onChange({ ...value, form })}
				errors={errors?.formFields}
			/>
		) : (
			<FormRowsEditor
				rows={value.formRows}
				allowFiles={contentType === "multipart/form-data"}
				onChange={(formRows) => onChange({ ...value, formRows })}
			/>
		);
	}
	if (contentType === "application/octet-stream") {
		return (
			<BinaryInput value={value.binary} onChange={(binary) => onChange({ ...value, binary })} />
		);
	}
	return (
		<div
			className={clsx(
				"h-[calc(100%-20px)] min-h-64 overflow-hidden rounded-md border",
				errors?.bodyError ? "border-danger" : "border-border",
			)}
		>
			<Editor
				height="100%"
				language={contentType.includes("json") ? "json" : "plaintext"}
				theme="vs-dark"
				value={value.raw}
				onChange={(raw) => onChange({ ...value, raw: raw ?? "" })}
				options={{
					minimap: { enabled: false },
					scrollBeyondLastLine: false,
					automaticLayout: true,
					fontSize: 13,
					lineHeight: 20,
					padding: { top: 10, bottom: 10 },
					// EditContext focuses a plain div, which react-aria's Space handling
					// doesn't treat as a text field; the textarea fallback keeps Space typing.
					editContext: false,
				}}
			/>
		</div>
	);
}

function FormRowsEditor({
	rows,
	allowFiles,
	onChange,
}: {
	rows: ApiFormRow[];
	allowFiles: boolean;
	onChange: (rows: ApiFormRow[]) => void;
}) {
	const update = (id: string, patch: Partial<ApiFormRow>) =>
		onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
	return (
		<div className="space-y-1.5">
			{rows.map((row) => {
				const isFile = allowFiles && row.isFile;
				return (
					<div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2" key={row.id}>
						<Input
							aria-label="Field name"
							placeholder="name"
							value={row.key}
							onChange={(event) => update(row.id, { key: event.target.value })}
							className="h-8 min-w-0 font-mono text-xs"
						/>
						{isFile ? (
							<FilePicker
								aria-label={`${row.key || "field"} file`}
								files={row.value instanceof File ? [row.value] : []}
								onChange={(files) => update(row.id, { value: files[0] ?? "" })}
							/>
						) : (
							<Input
								aria-label={`${row.key || "field"} value`}
								placeholder="value"
								value={typeof row.value === "string" ? row.value : ""}
								onChange={(event) => update(row.id, { value: event.target.value })}
								className="h-8 min-w-0 font-mono text-xs"
							/>
						)}
						<div className="flex items-start gap-1">
							{allowFiles && (
								<Button
									isIconOnly
									size="sm"
									variant="ghost"
									aria-label={isFile ? "Send text instead" : "Send a file instead"}
									onPress={() => update(row.id, { isFile: !isFile, value: "" })}
								>
									{isFile ? <TbLetterCase size={15} /> : <TbFile size={15} />}
								</Button>
							)}
							<DeleteIconButton
								aria-label={`Remove ${row.key || "row"}`}
								size="sm"
								iconSize={15}
								onPress={() => onChange(rows.filter((candidate) => candidate.id !== row.id))}
							/>
						</div>
					</div>
				);
			})}
			{/* a key may repeat: that's how several files go under one field */}
			<Button size="sm" variant="secondary" onPress={() => onChange([...rows, createRow()])}>
				<TbPlus size={14} />
				Add field
			</Button>
		</div>
	);
}

function BinaryInput({
	value,
	onChange,
}: {
	value: File | string;
	onChange: (value: File | string) => void;
}) {
	const isFile = value instanceof File;
	const [mode, setMode] = useState<"file" | "base64">(isFile || value === "" ? "file" : "base64");
	const invalid = typeof value === "string" && value.trim() !== "" && !base64ToBlob(value);
	return (
		<div className="space-y-2">
			<div className="inline-flex rounded-md border border-border p-0.5">
				{(["file", "base64"] as const).map((option) => (
					<Button
						key={option}
						size="sm"
						variant={mode === option ? "secondary" : "ghost"}
						className="h-6 text-xs"
						onPress={() => {
							setMode(option);
							onChange("");
						}}
					>
						{option === "file" ? "File" : "Base64"}
					</Button>
				))}
			</div>
			{mode === "file" ? (
				<FilePicker
					aria-label="Body file"
					files={isFile ? [value] : []}
					onChange={(files) => onChange(files[0] ?? "")}
				/>
			) : (
				<>
					<textarea
						aria-label="Base64 body"
						placeholder="Paste base64 data"
						value={isFile ? "" : value}
						onChange={(event) => onChange(event.target.value)}
						className={clsx(
							"h-40 w-full resize-y rounded-md border bg-surface p-2 font-mono text-xs outline-none",
							invalid ? "border-danger" : "border-border",
						)}
					/>
					{invalid && <span className="block text-[10px] text-danger">Not valid base64</span>}
				</>
			)}
		</div>
	);
}
