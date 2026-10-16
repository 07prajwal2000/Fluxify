import { Button, Checkbox, Input } from "@fluxify/components";
import { useMemo, useState } from "react";
import { TbSearch } from "react-icons/tb";

interface PageItem {
	title: string;
	url: string;
}

interface PagePickerProps {
	pages: PageItem[];
	selectedPages: string[];
	onChange: (selected: string[]) => void;
	isDisabled?: boolean;
}

export function PagePicker({
	pages,
	selectedPages,
	onChange,
	isDisabled = false,
}: PagePickerProps) {
	const [search, setSearch] = useState("");

	const filteredPages = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return pages;
		return pages.filter(
			(p) => p.title.toLowerCase().includes(q) || p.url.toLowerCase().includes(q),
		);
	}, [pages, search]);

	const allFilteredSelected =
		filteredPages.length > 0 && filteredPages.every((p) => selectedPages.includes(p.url));

	function handleToggleAll() {
		if (isDisabled) return;
		if (allFilteredSelected) {
			// Deselect all filtered
			const filteredUrls = new Set(filteredPages.map((p) => p.url));
			onChange(selectedPages.filter((url) => !filteredUrls.has(url)));
		} else {
			// Select all filtered (up to 200)
			const nextSet = new Set(selectedPages);
			for (const p of filteredPages) {
				if (nextSet.size < 200) {
					nextSet.add(p.url);
				}
			}
			onChange(Array.from(nextSet));
		}
	}

	function handleTogglePage(url: string) {
		if (isDisabled) return;
		if (selectedPages.includes(url)) {
			onChange(selectedPages.filter((u) => u !== url));
		} else {
			if (selectedPages.length >= 200) return;
			onChange([...selectedPages, url]);
		}
	}

	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-secondary/30 p-3">
			<div className="flex items-center justify-between gap-2">
				<div className="flex items-center gap-2">
					<span className="text-xs font-semibold text-foreground">
						Select Pages ({selectedPages.length} of {pages.length} selected)
					</span>
					{selectedPages.length >= 200 && (
						<span className="text-[11px] text-warning">Max 200 pages</span>
					)}
				</div>
				{!isDisabled && (
					<Button variant="ghost" size="sm" onPress={handleToggleAll} className="text-xs h-7 px-2">
						{allFilteredSelected ? "Deselect all" : "Select all"}
					</Button>
				)}
			</div>

			<div className="relative">
				<Input
					placeholder="Filter pages by title or URL..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					className="text-xs pl-8"
				/>
				<TbSearch className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" size={14} />
			</div>

			<div className="flex max-h-60 flex-col gap-1 overflow-y-auto pr-1">
				{filteredPages.length === 0 ? (
					<p className="py-4 text-center text-xs text-muted">No matching pages found</p>
				) : (
					filteredPages.map((page) => {
						const isChecked = selectedPages.includes(page.url);
						return (
							<div
								key={page.url}
								className="flex items-start gap-2.5 rounded-md p-2 hover:bg-surface-secondary transition-colors"
							>
								<Checkbox
									isSelected={isChecked}
									isDisabled={isDisabled}
									onChange={() => handleTogglePage(page.url)}
									className="mt-0.5"
								/>
								<button
									type="button"
									disabled={isDisabled}
									onClick={() => handleTogglePage(page.url)}
									className="min-w-0 flex-1 text-left"
								>
									<p className="truncate text-xs font-medium text-foreground">
										{page.title || page.url}
									</p>
									<p className="truncate font-mono text-[11px] text-muted">{page.url}</p>
								</button>
							</div>
						);
					})
				)}
			</div>
		</div>
	);
}
