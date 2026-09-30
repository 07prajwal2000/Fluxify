import { CloseButton, Input, Label, Modal, TextField } from "@fluxify/components";
import { type ReactNode, useMemo, useState } from "react";

export type PickerItem = {
	id: string;
	label: string;
	description?: string | null;
	icon?: ReactNode;
	/** shown but not pickable, with the reason as a hint */
	disabledReason?: string;
};

/**
 * Pick one item from a searchable list (#534). The middleware chain's "+" uses
 * it for custom blocks and the route settings use it for middlewares.
 */
export function PickerModal({
	open,
	onOpenChange,
	title,
	items,
	empty,
	onPick,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: string;
	items: PickerItem[];
	/** what to show when there is nothing to pick at all */
	empty: ReactNode;
	onPick: (item: PickerItem) => void;
}) {
	const [search, setSearch] = useState("");
	const shown = useMemo(() => {
		const q = search.trim().toLowerCase();
		return q
			? items.filter((i) => [i.label, i.description ?? ""].some((v) => v.toLowerCase().includes(q)))
			: items;
	}, [items, search]);

	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="md">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>{title}</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-3">
							{items.length === 0 ? (
								<div className="py-6 text-center text-sm text-muted">{empty}</div>
							) : (
								<>
									<TextField value={search} onChange={setSearch} autoFocus>
										<Label className="sr-only">Search</Label>
										<Input placeholder="Search" />
									</TextField>
									<ul className="flex max-h-80 flex-col gap-1 overflow-y-auto">
										{shown.map((item) => (
											<li key={item.id}>
												<button
													type="button"
													disabled={!!item.disabledReason}
													onClick={() => {
														onPick(item);
														onOpenChange(false);
													}}
													className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-surface-secondary focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50"
												>
													{item.icon}
													<span className="min-w-0 flex-1">
														<span className="block truncate text-sm text-foreground">
															{item.label}
														</span>
														<span className="block truncate text-xs text-muted">
															{item.disabledReason ?? item.description ?? ""}
														</span>
													</span>
												</button>
											</li>
										))}
										{shown.length === 0 && (
											<li className="py-4 text-center text-sm text-muted">No match</li>
										)}
									</ul>
								</>
							)}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
