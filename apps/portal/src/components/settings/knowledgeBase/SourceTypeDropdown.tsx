import { Label } from "@fluxify/components";
import { useEffect, useRef, useState } from "react";
import {
	TbCheck,
	TbChevronDown,
	TbFileText,
	TbLink,
	TbListCheck,
	TbUpload,
	TbWorld,
} from "react-icons/tb";

export type UiSourceType = "markdown" | "markdown-upload" | "url" | "llms_txt" | "llms_full_txt";

export interface SourceTypeOption {
	id: UiSourceType;
	label: string;
	desc: string;
	icon: React.ComponentType<{ size?: number; className?: string }>;
}

export const SOURCE_TYPE_OPTIONS: SourceTypeOption[] = [
	{
		id: "markdown",
		label: "Hand-written Markdown",
		desc: "Write or paste markdown documentation directly",
		icon: TbFileText,
	},
	{
		id: "markdown-upload",
		label: "Upload .md File",
		desc: "Upload an existing markdown file from disk",
		icon: TbUpload,
	},
	{
		id: "url",
		label: "HTML / Markdown URL",
		desc: "Fetch and index a single web page or markdown URL",
		icon: TbLink,
	},
	{
		id: "llms_txt",
		label: "llms.txt",
		desc: "Fetch an llms.txt index and pick linked pages",
		icon: TbListCheck,
	},
	{
		id: "llms_full_txt",
		label: "llms-full.txt",
		desc: "Fetch a complete, single-file llms-full.txt",
		icon: TbWorld,
	},
];

interface SourceTypeDropdownProps {
	value: UiSourceType;
	onChange: (value: UiSourceType) => void;
	isDisabled?: boolean;
}

export function SourceTypeDropdown({
	value,
	onChange,
	isDisabled = false,
}: SourceTypeDropdownProps) {
	const [isOpen, setIsOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	const selected = SOURCE_TYPE_OPTIONS.find((opt) => opt.id === value) ?? SOURCE_TYPE_OPTIONS[0];
	const SelectedIcon = selected.icon;

	useEffect(() => {
		function handleClickOutside(event: MouseEvent) {
			if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
				setIsOpen(false);
			}
		}
		if (isOpen) {
			document.addEventListener("mousedown", handleClickOutside);
		}
		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
		};
	}, [isOpen]);

	function handleSelect(id: UiSourceType) {
		onChange(id);
		setIsOpen(false);
	}

	return (
		<div ref={containerRef} className="relative flex flex-col gap-1 max-w-xl">
			<Label className="text-xs font-semibold text-foreground uppercase tracking-wider">
				Source Type
			</Label>
			<button
				type="button"
				disabled={isDisabled}
				onClick={() => setIsOpen((prev) => !prev)}
				className="flex w-full items-center justify-between rounded-lg border border-border bg-surface px-3 py-2 text-left transition-colors hover:bg-surface-secondary/60 focus:border-accent focus:outline-none disabled:opacity-50"
			>
				<div className="flex items-center gap-3 min-w-0">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-surface-secondary">
						<SelectedIcon size={18} className="text-accent" />
					</div>
					<div className="min-w-0">
						<div className="text-xs font-medium text-foreground">{selected.label}</div>
						<div className="truncate text-[11px] text-muted">{selected.desc}</div>
					</div>
				</div>
				<TbChevronDown
					size={16}
					className={`text-muted transition-transform ml-2 shrink-0 ${isOpen ? "rotate-180" : ""}`}
				/>
			</button>

			{isOpen && (
				<div className="absolute top-full z-50 mt-1 w-full rounded-lg border border-border bg-surface shadow-xl p-1 flex flex-col gap-0.5">
					{SOURCE_TYPE_OPTIONS.map((opt) => {
						const isCurrent = opt.id === value;
						const Icon = opt.icon;
						return (
							<button
								key={opt.id}
								type="button"
								onClick={() => handleSelect(opt.id)}
								className={`flex w-full items-center justify-between rounded-md p-2.5 text-left transition-colors ${
									isCurrent
										? "bg-accent/10 text-accent font-medium"
										: "hover:bg-surface-secondary text-foreground"
								}`}
							>
								<div className="flex items-center gap-3 min-w-0">
									<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-surface-secondary">
										<Icon size={16} className={isCurrent ? "text-accent" : "text-muted"} />
									</div>
									<div className="min-w-0">
										<div className="text-xs font-medium text-foreground">{opt.label}</div>
										<div className="truncate text-[11px] text-muted">{opt.desc}</div>
									</div>
								</div>
								{isCurrent && <TbCheck size={16} className="text-accent shrink-0 ml-2" />}
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}
