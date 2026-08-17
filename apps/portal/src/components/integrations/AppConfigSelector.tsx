import { useEffect, useState } from "react";
import { Label, cn } from "@fluxify/components";
import { TbSquareKey, TbX } from "react-icons/tb";
import { AppConfigSelectorModal } from "./AppConfigSelectorModal";

type Props = {
	projectId: string;
	value: string;
	label?: string;
	description?: string;
	placeholder?: string;
	onChange?: (value: string) => void;
};

// Field that holds either a literal value or an app-config reference (`cfg:<key>`)
// selected via a dedicated modal dialog.
export function AppConfigSelector({
	projectId,
	value,
	label,
	description,
	placeholder,
	onChange,
}: Props) {
	const [local, setLocal] = useState(value);
	const [modalOpen, setModalOpen] = useState(false);

	useEffect(() => setLocal(value), [value]);

	const isConfig = local.startsWith("cfg:");
	function set(v: string) {
		setLocal(v);
		onChange?.(v);
	}

	return (
		<div className="relative flex w-full flex-col gap-1">
			{label && <Label>{label}</Label>}
			{description && <span className="text-xs text-muted">{description}</span>}
			<div
				className={cn(
					"flex items-center gap-1 rounded-md border border-border bg-background-secondary pr-1",
					isConfig && "border-accent/40",
				)}
			>
				{isConfig ? (
					<span className="flex flex-1 items-center gap-2 rounded-l-md bg-accent-soft px-2 py-1.5 text-sm text-accent">
						<span className="flex-1 truncate font-mono text-xs">{local.slice(4)}</span>
						<button
							type="button"
							aria-label="Clear"
							onClick={() => set("")}
							className="text-accent/70 hover:text-accent"
						>
							<TbX size={15} />
						</button>
					</span>
				) : (
					<input
						className="flex-1 bg-transparent px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted"
						placeholder={placeholder}
						value={local}
						onChange={(e) => set(e.target.value)}
					/>
				)}
				<button
					type="button"
					aria-label="Use app config value"
					onClick={() => setModalOpen(true)}
					className={cn(
						"inline-flex size-7 items-center justify-center rounded-md transition-colors",
						isConfig ? "text-accent" : "text-muted hover:text-foreground",
					)}
				>
					<TbSquareKey size={18} />
				</button>
			</div>

			<AppConfigSelectorModal
				projectId={projectId}
				isOpen={modalOpen}
				onOpenChange={setModalOpen}
				selectedValue={local}
				// The modal hands back a bare key and the caller decides how to store
				// it: this field is a hybrid — a literal or a reference — so it needs
				// the `cfg:` marker to tell them apart. Fields with no literal mode
				// (AppConfigField) store the bare key instead.
				onSelect={(keyName) => set(`cfg:${keyName}`)}
				onClear={() => set("")}
			/>
		</div>
	);
}

