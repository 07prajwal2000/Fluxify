import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Chip, CloseButton, Input, Modal, Spinner, cn } from "@fluxify/components";
import {
	TbCheck,
	TbKey,
	TbLock,
	TbRefresh,
	TbSearch,
	TbX,
} from "react-icons/tb";
import { appConfigQuery } from "@/query/appConfigQuery";

export type AppConfigSelectorModalProps = {
	projectId: string;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	selectedValue?: string;
	onSelect: (keyName: string) => void;
	onClear?: () => void;
};

export function AppConfigSelectorModal({
	projectId,
	isOpen,
	onOpenChange,
	selectedValue = "",
	onSelect,
	onClear,
}: AppConfigSelectorModalProps) {
	const [searchInput, setSearchInput] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");
	const bottomRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(searchInput);
		}, 250);
		return () => clearTimeout(timer);
	}, [searchInput]);

	// Reset search when modal opens
	useEffect(() => {
		if (isOpen) {
			setSearchInput("");
			setDebouncedSearch("");
		}
	}, [isOpen]);

	const {
		data,
		isLoading,
		isFetchingNextPage,
		hasNextPage,
		fetchNextPage,
		refetch,
	} = appConfigQuery.getAll.useInfiniteQuery(projectId, {
		perPage: 50,
		search: debouncedSearch,
		sortBy: "keyName",
		sort: "asc",
	});

	// Infinite scroll observer
	useEffect(() => {
		if (!bottomRef.current || !hasNextPage || isFetchingNextPage) return;
		const observer = new IntersectionObserver((entries) => {
			if (entries[0].isIntersecting) {
				fetchNextPage();
			}
		});
		observer.observe(bottomRef.current);
		return () => observer.disconnect();
	}, [hasNextPage, isFetchingNextPage, fetchNextPage]);

	const items = useMemo(() => {
		if (!data?.pages) return [];
		return data.pages.flatMap((page) => page.data);
	}, [data?.pages]);

	const activeKey = selectedValue.startsWith("cfg:")
		? selectedValue.slice(4)
		: selectedValue;

	function handleSelect(keyName: string) {
		onSelect(keyName);
		onOpenChange(false);
	}

	function handleClear() {
		onClear?.();
		onOpenChange(false);
	}

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="w-full !max-w-2xl">
						<Modal.Header className="flex flex-col gap-3 px-6 pb-2 pt-5">
							<div className="flex items-start justify-between gap-3">
								<div className="flex min-w-0 flex-1 items-center gap-3">
									<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
										<TbKey size={20} />
									</span>
									<div className="min-w-0 flex-1">
										<Modal.Heading className="text-base font-semibold text-foreground">
											Select App Config Key
										</Modal.Heading>
										<p className="mt-0.5 text-xs text-muted">
											Choose an application configuration key or secret to reference in this field.
										</p>
									</div>
								</div>
								<CloseButton />
							</div>

							<div className="flex items-center gap-2 pt-1">
								<div className="relative flex-1">
									<TbSearch
										className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
										size={15}
									/>
									<Input
										placeholder="Search configuration keys…"
										value={searchInput}
										onChange={(e) => setSearchInput(e.currentTarget.value)}
										className="h-8 w-full pl-8 pr-7 text-xs"
									/>
									{searchInput && (
										<button
											type="button"
											aria-label="Clear search"
											onClick={() => setSearchInput("")}
											className="absolute right-2 top-1/2 -translate-y-1/2 text-muted transition-colors hover:text-foreground"
										>
											<TbX size={13} />
										</button>
									)}
								</div>
								<Button
									isIconOnly
									variant="outline"
									size="sm"
									onPress={() => refetch()}
									aria-label="Refresh keys"
									className="size-8"
								>
									<TbRefresh size={14} />
								</Button>
							</div>
						</Modal.Header>

						<Modal.Body className="px-6 pb-4 pt-2">
							{isLoading ? (
								<div className="flex flex-col items-center justify-center py-16">
									<Spinner />
									<span className="mt-2 text-xs text-muted">Loading configuration keys…</span>
								</div>
							) : items.length === 0 ? (
								debouncedSearch ? (
									<div className="flex flex-col items-center justify-center py-12 text-center">
										<TbSearch size={26} className="text-muted/60 mb-2" />
										<p className="text-sm font-medium text-foreground">
											No keys matching &ldquo;{debouncedSearch}&rdquo;
										</p>
										<p className="mt-1 text-xs text-muted">
											Try adjusting your search terms.
										</p>
										<Button
											variant="outline"
											size="sm"
											className="mt-3 text-xs"
											onPress={() => setSearchInput("")}
										>
											Clear search
										</Button>
									</div>
								) : (
									<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-12 text-center">
										<TbKey size={30} className="text-muted/60 mb-2" />
										<p className="text-sm font-medium text-foreground">
											No configuration keys found
										</p>
										<p className="mt-1 max-w-xs text-xs text-muted">
											You can create configuration keys and secrets in Project Settings &rarr; App Config.
										</p>
									</div>
								)
							) : (
								<div className="flex max-h-[440px] min-h-[260px] flex-col gap-2 overflow-y-auto pr-1">
									{items.map((item) => {
										const isSelected = activeKey === item.keyName;
										return (
											<button
												key={item.id}
												type="button"
												onClick={() => handleSelect(item.keyName)}
												className={cn(
													"group flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-150",
													isSelected
														? "border-accent bg-accent/10 shadow-sm ring-1 ring-accent"
														: "border-border bg-surface hover:border-accent hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
												)}
											>
												<div className="flex min-w-0 flex-1 items-center gap-2.5">
													<span
														className={cn(
															"flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors",
															isSelected
																? "bg-accent text-accent-foreground"
																: "bg-surface-secondary text-foreground group-hover:bg-accent group-hover:text-accent-foreground",
														)}
													>
														{item.isEncrypted ? <TbLock size={15} /> : <TbKey size={15} />}
													</span>
													<span className="truncate font-mono text-xs font-semibold text-foreground">
															{item.keyName}
													</span>
													<Chip size="sm" color="accent" className="text-[11px] font-medium shrink-0">
														{item.dataType || "string"}
													</Chip>
													{item.isEncrypted && (
														<span className="flex shrink-0 items-center gap-0.5 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
															<TbLock size={10} /> Encrypted
														</span>
													)}
													{item.encodingType && item.encodingType !== "plaintext" && (
														<span className="shrink-0 rounded bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase text-muted">
															{item.encodingType}
														</span>
													)}
												</div>
												<div className="shrink-0">
													{isSelected ? (
														<span className="flex size-6 items-center justify-center rounded-full bg-accent text-accent-foreground">
															<TbCheck size={13} strokeWidth={3} />
														</span>
													) : (
														<span className="text-xs font-medium text-muted transition-colors group-hover:text-foreground">
															Select
														</span>
													)}
												</div>
											</button>
										);
									})}
									<div ref={bottomRef} className="h-1 w-full" />
									{isFetchingNextPage && (
										<div className="flex items-center justify-center py-2">
											<Spinner size="sm" />
										</div>
									)}
								</div>
							)}
						</Modal.Body>

						<Modal.Footer className="flex items-center justify-between border-t border-border px-6 pb-5 pt-3">
							<div>
								{activeKey ? (
									<Button
										variant="outline"
										size="sm"
										onPress={handleClear}
										className="text-xs"
									>
										<TbX size={13} /> Clear selection
									</Button>
								) : null}
							</div>
							<Button
								variant="outline"
								size="sm"
								onPress={() => onOpenChange(false)}
								className="text-xs"
							>
								Close
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
