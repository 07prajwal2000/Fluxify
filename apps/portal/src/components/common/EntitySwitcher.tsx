import { Button, ListBox, Select, Spinner } from "@fluxify/components";
import { TbArrowLeft, TbChevronLeft, TbChevronRight } from "react-icons/tb";

export type SwitcherItem = {
	id: string;
	/** What the trigger and the list row render. */
	label: React.ReactNode;
	/** Plain text for type-ahead, since `label` is markup. */
	textValue: string;
};

/**
 * Canvas header nav: back to the list this thing belongs to, plus a stepper and
 * a dropdown over its siblings.
 *
 * Routes, custom blocks and workflows all sit on the same canvas, so they all
 * need the same header. It used to be one copy per entity, which is how a third
 * copy would have arrived with workflows.
 */
export function EntitySwitcher({
	backLabel,
	noun,
	items,
	currentId,
	isLoading,
	hasMore,
	onBack,
	onSelect,
}: {
	backLabel: string;
	/** Names the controls for screen readers — "route", "workflow". */
	noun: string;
	items: SwitcherItem[];
	currentId: string;
	isLoading?: boolean;
	/** More siblings exist than were fetched, so the counter says "of 50+". */
	hasMore?: boolean;
	onBack: () => void;
	onSelect: (id: string) => void;
}) {
	const index = items.findIndex((item) => item.id === currentId);
	const current = index >= 0 ? items[index] : undefined;

	function step(delta: number) {
		const next = items[index + delta];
		if (next) onSelect(next.id);
	}

	return (
		<div className="flex min-w-0 items-center gap-2">
			<Button variant="ghost" size="sm" aria-label={`Back to ${backLabel}`} onPress={onBack}>
				<TbArrowLeft size={16} /> {backLabel}
			</Button>

			<span className="h-5 w-px bg-border" />

			{isLoading ? (
				<Spinner size="sm" />
			) : (
				<div className="flex min-w-0 items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						aria-label={`Previous ${noun}`}
						isDisabled={index <= 0}
						onPress={() => step(-1)}
					>
						<TbChevronLeft size={16} />
					</Button>

					<Select
						aria-label={`Switch ${noun}`}
						selectedKey={current?.id ?? null}
						onSelectionChange={(key) => key && onSelect(key as string)}
						className="min-w-0"
					>
						<Select.Trigger className="min-w-0 max-w-[22rem]">
							{current?.label ?? (
								<span className="truncate text-xs text-muted">Unknown {noun}</span>
							)}
							<Select.Indicator />
						</Select.Trigger>
						<Select.Popover className="max-h-80 w-[26rem]">
							<ListBox>
								{items.map((item) => (
									<ListBox.Item key={item.id} id={item.id} textValue={item.textValue}>
										{item.label}
										<ListBox.ItemIndicator />
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>

					<Button
						variant="ghost"
						size="sm"
						aria-label={`Next ${noun}`}
						isDisabled={index < 0 || index >= items.length - 1}
						onPress={() => step(1)}
					>
						<TbChevronRight size={16} />
					</Button>

					{index >= 0 && (
						<span className="ml-1 whitespace-nowrap text-xs text-muted">
							{index + 1} / {items.length}
							{hasMore && "+"}
						</span>
					)}
				</div>
			)}
		</div>
	);
}
