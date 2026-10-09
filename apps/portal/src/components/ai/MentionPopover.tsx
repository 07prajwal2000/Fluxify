import { Input, integrationIcons, Spinner } from "@fluxify/components";
import { forwardRef, useEffect, useState } from "react";
import { useDebounce } from "@/hooks/useDebounce";
import { type Mention, useResourceSearch } from "@/query/resourceSearchQuery";
import { REF_ICONS } from "./AgentRef";

function MentionIcon({ res }: { res: Mention }) {
	if (res.type === "integration" && res.variant && integrationIcons[res.variant])
		return (
			<span className="inline-flex items-center [&>svg]:h-4 [&>svg]:w-4">
				{integrationIcons[res.variant]}
			</span>
		);
	const Icon = REF_ICONS[res.type];
	return <Icon size={16} />;
}

type Props = {
	projectId: string;
	/** Opened by typing @: the @ is replaced by the chip. */
	wasAtTyped: boolean;
	onClose: () => void;
};

/** The @ picker: search the project's resources and insert one as a chip (`:ref[…]{…}`) into the prompt. */
export const MentionPopover = forwardRef<HTMLDivElement, Props>(function MentionPopover(
	{ projectId, wasAtTyped, onClose },
	ref,
) {
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedIndex, setSelectedIndex] = useState(0);
	const debounced = useDebounce(searchQuery, 300);
	const { results, isLoading, isFetching } = useResourceSearch(projectId, debounced);
	const searching = searchQuery !== debounced || isLoading || isFetching;

	// biome-ignore lint/correctness/useExhaustiveDependencies: the highlight starts over on a new result list
	useEffect(() => setSelectedIndex(0), [results.length, debounced]);

	const pick = (res: Mention) => {
		document.dispatchEvent(new CustomEvent("insert-resource", { detail: { res, wasAtTyped } }));
		onClose();
	};
	const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			e.preventDefault();
			onClose();
			document.dispatchEvent(new CustomEvent("focus-editor"));
		} else if (!results.length) {
			return;
		} else if (e.key === "ArrowDown") {
			e.preventDefault();
			setSelectedIndex((i) => Math.min(i + 1, results.length - 1));
		} else if (e.key === "ArrowUp") {
			e.preventDefault();
			setSelectedIndex((i) => Math.max(i - 1, 0));
		} else if (e.key === "Enter") {
			e.preventDefault();
			if (results[selectedIndex]) pick(results[selectedIndex]);
		}
	};
	const hint = debounced
		? "No resources found"
		: "Type to search routes, workflows, triggers, middlewares, custom blocks, integrations, configs and tests";

	return (
		<div
			ref={ref}
			className="absolute bottom-[calc(100%+8px)] left-0 z-50 w-full rounded-xl border border-border bg-overlay p-2 shadow-xl"
		>
			<div className="flex items-center gap-3">
				<Input
					value={searchQuery}
					onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
					onKeyDown={onKeyDown}
					placeholder="Search resources..."
					autoFocus
					className="h-9 min-h-9 w-64 rounded-lg border-border bg-surface px-3 text-sm text-foreground placeholder:text-muted hover:bg-surface-secondary focus-within:ring-1 focus-within:ring-focus"
				/>
				{searching && <Spinner size="sm" color="current" />}
			</div>
			<div className="mt-2 h-[150px] w-full overflow-y-auto">
				{results.length > 0 ? (
					<div className="flex flex-col gap-1">
						{results.map((res, i) => (
							<button
								type="button"
								key={`${res.type}:${res.id}`}
								onClick={() => pick(res)}
								// the arrow-key selection used to be the same wash as hover, so there was no telling where the cursor was
								className={`flex items-center gap-3 rounded-lg p-2 text-left transition-colors ${
									i === selectedIndex
										? "bg-accent/15 text-foreground ring-1 ring-inset ring-accent/50"
										: "hover:bg-surface-secondary"
								}`}
							>
								<div className={`shrink-0 ${i === selectedIndex ? "text-accent" : "text-muted"}`}>
									<MentionIcon res={res} />
								</div>
								<div className="flex min-w-0 flex-col">
									<span className="truncate text-sm font-medium text-foreground">
										{res.label || res.name}
										<span className="ml-2 text-[10px] uppercase tracking-wider text-muted">
											{res.type.replace("_", " ")}
										</span>
									</span>
									{res.description && (
										<span className="line-clamp-1 text-xs text-muted">{res.description}</span>
									)}
								</div>
							</button>
						))}
					</div>
				) : (
					<div className="flex h-full items-center justify-center p-3 text-center text-xs text-muted">
						{searching ? "Searching..." : hint}
					</div>
				)}
			</div>
		</div>
	);
});
