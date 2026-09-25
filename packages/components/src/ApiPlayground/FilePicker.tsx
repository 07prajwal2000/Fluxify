import { Button } from "@heroui/react";
import clsx from "clsx";
import { useRef } from "react";
import { TbPaperclip } from "react-icons/tb";
import { CloseButton } from "../CloseButton";

type FilePickerProps = {
	files: File[];
	onChange: (files: File[]) => void;
	multiple?: boolean;
	isInvalid?: boolean;
	"aria-label"?: string;
};

export function formatBytes(bytes: number) {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A button that opens the file browser, with each chosen file listed and removable. */
export function FilePicker({
	files,
	onChange,
	multiple,
	isInvalid,
	"aria-label": ariaLabel,
}: FilePickerProps) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<div
			className={clsx(
				"space-y-1 rounded-md border border-dashed p-1.5",
				isInvalid ? "border-danger" : "border-border",
			)}
		>
			<input
				ref={input}
				type="file"
				hidden
				multiple={multiple}
				aria-label={ariaLabel}
				onChange={(event) => {
					const picked = Array.from(event.target.files ?? []);
					onChange(multiple ? [...files, ...picked] : picked);
					// so picking the same file again after removing it still fires
					event.target.value = "";
				}}
			/>
			{files.map((file, index) => (
				<div
					key={`${file.name}-${index}`}
					className="flex h-7 items-center gap-2 rounded bg-surface-secondary px-2 font-mono text-xs"
				>
					<span className="min-w-0 flex-1 truncate">{file.name}</span>
					<span className="shrink-0 text-[10px] text-muted">{formatBytes(file.size)}</span>
					<CloseButton
						// no "close" slot: inside a modal that would dismiss the modal
						slot={null}
						aria-label={`Remove ${file.name}`}
						iconSize={13}
						className="size-5 min-w-5"
						onPress={() => onChange(files.filter((_, i) => i !== index))}
					/>
				</div>
			))}
			{(multiple || files.length === 0) && (
				<Button
					size="sm"
					variant="ghost"
					className="h-7 w-full justify-start text-xs text-muted"
					onPress={() => input.current?.click()}
				>
					<TbPaperclip size={14} />
					{multiple && files.length > 0 ? "Add files" : multiple ? "Choose files" : "Choose file"}
				</Button>
			)}
		</div>
	);
}
