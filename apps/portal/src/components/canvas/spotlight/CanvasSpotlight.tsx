import { useEffect, useMemo, useRef, useState } from "react";
import { Kbd, Modal, cn } from "@fluxify/components";
import { TbSearch } from "react-icons/tb";
import { comboLabel } from "../actions/combo";
import { filterSpotlightCommands } from "./spotlightFilter";
import type { SpotlightCategory, SpotlightCommand } from "./types";

export type CanvasSpotlightProps = {
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	commands: SpotlightCommand[];
};

export function CanvasSpotlight({
	isOpen,
	onOpenChange,
	commands,
}: CanvasSpotlightProps) {
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const { commands: filtered, mode } = useMemo(
		() => filterSpotlightCommands(commands, query),
		[commands, query],
	);

	useEffect(() => {
		if (isOpen) {
			setQuery("");
			setActiveIndex(0);
			requestAnimationFrame(() => inputRef.current?.focus());
		}
	}, [isOpen]);

	useEffect(() => {
		setActiveIndex(0);
	}, [query]);

	useEffect(() => {
		if (filtered.length === 0) return;
		const activeItem = document.getElementById(`spotlight-item-${activeIndex}`);
		if (activeItem) {
			activeItem.scrollIntoView({ block: "nearest" });
		}
	}, [activeIndex, filtered.length]);

	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (filtered.length === 0) return;

		if (e.key === "ArrowDown") {
			e.preventDefault();
			setActiveIndex((prev) => (prev + 1) % filtered.length);
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setActiveIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
		} else if (e.key === "Enter") {
			e.preventDefault();
			const selected = filtered[activeIndex];
			if (selected && !selected.disabled) {
				selected.onSelect();
			}
		}
	};

	// Group filtered commands by category while maintaining flat indexing for keyboard selection
	const groups = useMemo(() => {
		const map = new Map<SpotlightCategory, { command: SpotlightCommand; flatIndex: number }[]>();
		filtered.forEach((cmd, idx) => {
			const existing = map.get(cmd.category) ?? [];
			existing.push({ command: cmd, flatIndex: idx });
			map.set(cmd.category, existing);
		});
		return Array.from(map.entries());
	}, [filtered]);

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop variant="blur" className="backdrop-blur-xs bg-black/50">
				<Modal.Container placement="top" className="pt-[12vh] px-4">
					<Modal.Dialog
						aria-label="Command Palette"
						className="w-full max-w-2xl overflow-hidden rounded-xl border border-border bg-background shadow-2xl shadow-black/60 p-0 text-foreground"
					>
						<div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
							<TbSearch size={18} className="text-muted shrink-0" />
							<input
								ref={inputRef}
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={onKeyDown}
								placeholder="Type a command or search (e.g. goto, add, save)..."
								className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted focus:outline-none"
							/>
							<Kbd className="shrink-0 px-1.5 py-0.5 text-[10px]">Esc</Kbd>
						</div>

						{query === "" && (
							<div className="flex items-center gap-2 border-b border-border bg-surface/30 px-3.5 py-1.5 text-xs text-muted">
								<span className="font-medium">Quick hints:</span>
								<button
									type="button"
									onClick={() => {
										setQuery("goto ");
										inputRef.current?.focus();
									}}
									className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:bg-surface-secondary"
								>
									goto &gt;
								</button>
								<span>to jump to pages</span>
								<span className="text-muted/50">•</span>
								<button
									type="button"
									onClick={() => {
										setQuery("add ");
										inputRef.current?.focus();
									}}
									className="rounded bg-surface px-1.5 py-0.5 font-mono text-[11px] text-foreground hover:bg-surface-secondary"
								>
									add &gt;
								</button>
								<span>to search &amp; add blocks</span>
							</div>
						)}

						<div
							ref={listRef}
							role="listbox"
							aria-label="Command suggestions"
							className="max-h-[50vh] overflow-y-auto p-1.5"
						>
							{filtered.length === 0 ? (
								<div className="py-10 text-center text-sm text-muted">
									No commands or items found for &ldquo;{query}&rdquo;
								</div>
							) : (
								groups.map(([category, items]) => (
									<div key={category} className="mb-2 last:mb-0">
										<div className="px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
											{category}
										</div>
										<div className="space-y-0.5">
											{items.map(({ command, flatIndex }) => {
												const isSelected = activeIndex === flatIndex;
												return (
													<button
														key={command.id}
														id={`spotlight-item-${flatIndex}`}
														type="button"
														role="option"
														aria-selected={isSelected}
														disabled={command.disabled}
														onMouseEnter={() => setActiveIndex(flatIndex)}
														onClick={() => !command.disabled && command.onSelect()}
														className={cn(
															"group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
															isSelected
																? "bg-accent/15 text-foreground ring-1 ring-accent/30"
																: "text-foreground hover:bg-surface-secondary",
															command.disabled && "cursor-not-allowed opacity-50",
														)}
													>
														<span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-surface text-foreground group-hover:bg-surface-secondary">
															{command.icon ?? <TbSearch size={14} />}
														</span>
														<div className="flex min-w-0 flex-1 flex-col">
															<span className="truncate text-sm font-medium">
																{command.title}
															</span>
															{(command.description || command.subtitle) && (
																<span className="truncate text-xs text-muted">
																	{command.disabledReason ||
																		command.description ||
																		command.subtitle}
																</span>
															)}
														</div>
														{command.shortcut && (
															<Kbd className="shrink-0 px-1.5 py-0.5 text-[10px]">
																{comboLabel(command.shortcut)}
															</Kbd>
														)}
													</button>
												);
											})}
										</div>
									</div>
								))
							)}
						</div>

						<footer className="flex items-center justify-between border-t border-border bg-surface/40 px-3.5 py-2 text-xs text-muted">
							<div className="flex items-center gap-3">
								<span className="flex items-center gap-1">
									<Kbd className="px-1 py-0 text-[10px]">↑</Kbd>
									<Kbd className="px-1 py-0 text-[10px]">↓</Kbd>
									<span>Navigate</span>
								</span>
								<span className="flex items-center gap-1">
									<Kbd className="px-1 py-0 text-[10px]">↵</Kbd>
									<span>Select</span>
								</span>
								<span className="flex items-center gap-1">
									<Kbd className="px-1 py-0 text-[10px]">Esc</Kbd>
									<span>Close</span>
								</span>
							</div>
							<span>
								{filtered.length} {filtered.length === 1 ? "result" : "results"}
								{mode !== "all" && ` (${mode})`}
							</span>
						</footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
