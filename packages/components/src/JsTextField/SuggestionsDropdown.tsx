import clsx from "clsx";
import { type RefObject, useLayoutEffect, useState } from "react";

// max-h-56 plus the mt-1 gap
const DROPDOWN_HEIGHT = 228;

/** where the list gets cut off: the nearest scrolling ancestor, within the window */
function visibleArea(el: HTMLElement) {
	for (let parent = el.parentElement; parent; parent = parent.parentElement) {
		const { overflowY } = getComputedStyle(parent);
		if (overflowY === "auto" || overflowY === "scroll") {
			const { top, bottom } = parent.getBoundingClientRect();
			return { top: Math.max(top, 0), bottom: Math.min(bottom, window.innerHeight) };
		}
	}
	return { top: 0, bottom: window.innerHeight };
}

/** open upward when the list does not fit below the field but has more room above */
function useOpensUpward(dropdownRef: RefObject<HTMLDivElement | null>) {
	const [upward, setUpward] = useState(false);
	useLayoutEffect(() => {
		const field = dropdownRef.current?.parentElement;
		if (!field) return;
		const rect = field.getBoundingClientRect();
		const area = visibleArea(field);
		const below = area.bottom - rect.bottom;
		setUpward(below < DROPDOWN_HEIGHT && rect.top - area.top > below);
	}, [dropdownRef]);
	return upward;
}

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
	const upward = useOpensUpward(dropdownRef);
	return (
		<div
			ref={dropdownRef}
			className={clsx(
				"absolute left-0 w-full max-h-56 overflow-y-auto rounded-lg p-1 shadow-2xl border border-border bg-surface z-50 min-w-full",
				upward ? "bottom-full mb-1" : "top-full mt-1",
			)}
		>
			{filteredSuggestions.length === 0 ? (
				<div className="px-3 py-2 text-xs text-muted text-center">No matching suggestions</div>
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
								<span className="text-[12px] shrink-0 ml-1.5 font-bold text-accent">✓</span>
							)}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
