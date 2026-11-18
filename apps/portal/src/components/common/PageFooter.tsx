import { Button, cn, ListBox, Select } from "@fluxify/components";
import type { ReactNode } from "react";
import { TbChevronDown } from "react-icons/tb";
import { PAGE_SIZES } from "@/lib/pageSize";

/** The rows-per-page select and Previous / Next of a list, the way the routes list has them. */
export function PageFooter({
	page,
	totalPages,
	perPage,
	onPage,
	onPerPage,
	children,
	className,
}: {
	page: number;
	totalPages: number;
	perPage: number;
	onPage: (page: number) => void;
	onPerPage: (perPage: number) => void;
	children?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex shrink-0 items-center gap-3 border-t border-border pt-3 text-sm text-muted",
				className,
			)}
		>
			{children}
			<span className="ml-auto">Rows per page:</span>
			<Select
				aria-label="Rows per page"
				value={String(perPage)}
				onChange={(v) => v && onPerPage(Number(v))}
				className="w-[80px]"
			>
				<Select.Trigger className="flex h-8 items-center justify-between gap-1 rounded-md border border-border bg-background px-2 text-sm">
					<Select.Value />
					<Select.Indicator>
						<TbChevronDown size={14} className="shrink-0 text-muted" />
					</Select.Indicator>
				</Select.Trigger>
				<Select.Popover>
					<ListBox>
						{PAGE_SIZES.map((n) => (
							<ListBox.Item key={n} id={String(n)} textValue={String(n)}>
								{n}
							</ListBox.Item>
						))}
					</ListBox>
				</Select.Popover>
			</Select>
			{totalPages > 1 && (
				<>
					<Button variant="outline" isDisabled={page <= 1} onPress={() => onPage(page - 1)}>
						Previous
					</Button>
					<span>
						Page {page} of {totalPages}
					</span>
					<Button
						variant="outline"
						isDisabled={page >= totalPages}
						onPress={() => onPage(page + 1)}
					>
						Next
					</Button>
				</>
			)}
		</div>
	);
}
