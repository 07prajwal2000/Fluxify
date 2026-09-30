import { Button, Chip, CloseButton, cn, Input, Modal } from "@fluxify/components";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { TbSearch, TbX } from "react-icons/tb";

export type PickerItem = {
	id: string;
	label: string;
	description?: string | null;
	icon?: ReactNode;
	/** a short fact shown as a chip, e.g. "3 blocks" */
	meta?: string;
	/** shown but not pickable, with the reason in place of "Select" */
	disabledReason?: string;
};

/**
 * Pick one item from a searchable list (#534), styled after the app config
 * selector. The middleware chain uses it for custom blocks and the route
 * settings use it for middlewares.
 */
export function PickerModal({
	open,
	onOpenChange,
	title,
	description,
	icon,
	searchPlaceholder = "Search…",
	items,
	empty,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	description: string;
	/** header icon, also the fallback for items without their own */
	icon: ReactNode;
	searchPlaceholder?: string;
	items: PickerItem[];
	/** what to show when there is nothing to pick at all */
	empty: ReactNode;
	onPick: (item: PickerItem) => void;
}) {
	const [search, setSearch] = useState("");
	useEffect(() => {
		if (open) setSearch("");
	}, [open]);

	const shown = useMemo(() => {
		const q = search.trim().toLowerCase();
		return q
			? items.filter((i) => [i.label, i.description ?? ""].some((v) => v.toLowerCase().includes(q)))
			: items;
	}, [items, search]);

	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="w-full !max-w-2xl">
						<Modal.Header className="flex flex-col gap-3">
							<div className="flex items-start justify-between gap-3">
								<div className="flex min-w-0 flex-1 items-center gap-3">
									<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
										{icon}
									</span>
									<div className="min-w-0 flex-1">
										<Modal.Heading className="text-base font-semibold text-foreground">
											{title}
										</Modal.Heading>
										<p className="mt-0.5 text-xs text-muted">{description}</p>
									</div>
								</div>
								<CloseButton />
							</div>

							{items.length > 0 && (
								<div className="relative pt-1">
									<TbSearch
										className="pointer-events-none absolute left-2.5 top-1/2 mt-0.5 -translate-y-1/2 text-muted"
										size={15}
									/>
									<Input
										autoFocus
										aria-label="Search"
										placeholder={searchPlaceholder}
										value={search}
										onChange={(e) => setSearch(e.currentTarget.value)}
										className="h-8 w-full pl-8 pr-7 text-xs"
									/>
									{search && (
										<button
											type="button"
											aria-label="Clear search"
											onClick={() => setSearch("")}
											className="absolute right-2 top-1/2 mt-0.5 -translate-y-1/2 text-muted transition-colors hover:text-foreground"
										>
											<TbX size={13} />
										</button>
									)}
								</div>
							)}
						</Modal.Header>

						<Modal.Body>
							{items.length === 0 ? (
								<div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border px-4 py-12 text-center">
									<span className="mb-2 text-muted/60">{icon}</span>
									<p className="max-w-sm text-xs text-muted">{empty}</p>
								</div>
							) : shown.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-12 text-center">
									<TbSearch size={26} className="mb-2 text-muted/60" />
									<p className="text-sm font-medium text-foreground">
										Nothing matches &ldquo;{search}&rdquo;
									</p>
									<Button
										variant="outline"
										size="sm"
										className="mt-3 text-xs"
										onPress={() => setSearch("")}
									>
										Clear search
									</Button>
								</div>
							) : (
								<div className="flex max-h-[440px] flex-col gap-2 overflow-y-auto pr-1">
									{shown.map((item) => {
										const disabled = !!item.disabledReason;
										return (
											<button
												key={item.id}
												type="button"
												disabled={disabled}
												onClick={() => {
													onPick(item);
													onOpenChange(false);
												}}
												className={cn(
													"group flex w-full items-center justify-between gap-3 rounded-xl border border-border bg-surface px-3.5 py-2.5 text-left transition-all duration-150",
													disabled
														? "cursor-not-allowed opacity-60"
														: "hover:border-accent hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
												)}
											>
												<div className="flex min-w-0 flex-1 items-center gap-2.5">
													<span
														className={cn(
															"flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-foreground transition-colors",
															!disabled && "group-hover:bg-accent/15",
														)}
													>
														{item.icon ?? icon}
													</span>
													<span className="flex min-w-0 flex-col">
														<span className="truncate text-xs font-semibold text-foreground">
															{item.label}
														</span>
														{item.description && (
															<span className="truncate text-[11px] text-muted">
																{item.description}
															</span>
														)}
													</span>
													{item.meta && (
														<Chip
															size="sm"
															color="accent"
															className="shrink-0 text-[11px] font-medium"
														>
															{item.meta}
														</Chip>
													)}
												</div>
												<span
													className={cn(
														"shrink-0 text-xs font-medium",
														disabled ? "text-muted" : "text-muted group-hover:text-foreground",
													)}
												>
													{item.disabledReason ?? "Select"}
												</span>
											</button>
										);
									})}
								</div>
							)}
						</Modal.Body>

						<Modal.Footer className="flex justify-end">
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
