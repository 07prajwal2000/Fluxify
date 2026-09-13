import clsx from "clsx";
import type { RefObject } from "react";

export type SuggestionsDropdownProps = {
	dropdownRef: RefObject<HTMLDivElement | null>;
	filteredSuggestions: string[];
	value: string;
	onSelect: (item: string) => void;
};

export function SuggestionsDropdown({
	dropdownRef,
	filteredSuggestions,
	value,
	onSelect,
}: SuggestionsDropdownProps) {
	return (
		<div
			ref={dropdownRef}
			className="absolute left-0 top-full mt-1 w-full max-h-56 overflow-y-auto rounded-lg p-1 shadow-2xl border border-border bg-surface z-50 min-w-full"
		>
			{filteredSuggestions.length === 0 ? (
				<div className="px-3 py-2 text-xs text-muted text-center">
					No matching suggestions
				</div>
			) : (
				<div className="flex flex-col gap-0.5" role="listbox">
					{filteredSuggestions.map((item) => (
						<button
							key={item}
							type="button"
							tabIndex={-1}
							onMouseDown={(e) => {
								e.preventDefault();
							}}
							onClick={() => onSelect(item)}
							className={clsx(
								"w-full text-left px-2.5 py-1.5 text-xs rounded-md cursor-pointer flex items-center justify-between transition-colors",
								item === value
									? "bg-surface-secondary text-foreground font-medium"
									: "text-muted hover:text-foreground hover:bg-surface-secondary/80 active:bg-surface-secondary",
							)}
						>
							<span className="truncate">{item}</span>
							{item === value && (
								<span className="text-[12px] shrink-0 ml-1.5 font-bold text-accent">
									✓
								</span>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
