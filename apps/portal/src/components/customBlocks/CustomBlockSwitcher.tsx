import { useNavigate } from "@tanstack/react-router";
import { Button, ListBox, Select, Spinner } from "@fluxify/components";
import { TbArrowLeft, TbChevronLeft, TbChevronRight } from "react-icons/tb";
import { customBlocksQuery } from "@/query/customBlocksQuery";

/**
 * Canvas header nav, same shape as the route canvas' switcher: back to the
 * project's custom block list plus a stepper over the sibling blocks.
 */
export function CustomBlockSwitcher({
	projectId,
	blockId,
}: {
	projectId: string;
	blockId: string;
}) {
	const navigate = useNavigate();
	const { data, isLoading } = customBlocksQuery.getAll.useQuery(projectId);
	const blocks = data ?? [];
	const index = blocks.findIndex((block) => block.id === blockId);
	const current = index >= 0 ? blocks[index] : undefined;

	function go(to: string) {
		navigate({
			to: "/$projectId/custom-block-canvas/$blockId",
			params: { projectId, blockId: to },
		});
	}

	function step(delta: number) {
		const next = blocks[index + delta];
		if (next) go(next.id);
	}

	return (
		<div className="flex min-w-0 items-center gap-2">
			<Button
				variant="ghost"
				size="sm"
				aria-label="Back to custom blocks"
				onPress={() => navigate({ to: "/$projectId/custom-blocks", params: { projectId } })}
			>
				<TbArrowLeft size={16} /> Custom blocks
			</Button>

			<span className="h-5 w-px bg-border" />

			{isLoading ? (
				<Spinner size="sm" />
			) : (
				<div className="flex min-w-0 items-center gap-1">
					<Button
						variant="ghost"
						size="sm"
						aria-label="Previous custom block"
						isDisabled={index <= 0}
						onPress={() => step(-1)}
					>
						<TbChevronLeft size={16} />
					</Button>

					<Select
						aria-label="Switch custom block"
						selectedKey={current?.id ?? null}
						onSelectionChange={(key) => key && go(key as string)}
						className="min-w-0"
					>
						<Select.Trigger className="min-w-0 max-w-[22rem]">
							<span className="flex min-w-0 items-center gap-2">
								<span className="truncate text-xs">{current?.label ?? "Unknown block"}</span>
								{current && (
									<span className="truncate font-mono text-[11px] text-muted">
										{current.name}
									</span>
								)}
							</span>
							<Select.Indicator />
						</Select.Trigger>
						<Select.Popover className="max-h-80 w-[26rem]">
							<ListBox>
								{blocks.map((block) => (
									<ListBox.Item
										key={block.id}
										id={block.id}
										textValue={`${block.label} ${block.name}`}
									>
										<span className="flex min-w-0 items-center gap-2">
											<span className="truncate text-xs">{block.label}</span>
											<span className="truncate font-mono text-[11px] text-muted">
												{block.name}
											</span>
										</span>
										<ListBox.ItemIndicator />
									</ListBox.Item>
								))}
							</ListBox>
						</Select.Popover>
					</Select>

					<Button
						variant="ghost"
						size="sm"
						aria-label="Next custom block"
						isDisabled={index < 0 || index >= blocks.length - 1}
						onPress={() => step(1)}
					>
						<TbChevronRight size={16} />
					</Button>

					{index >= 0 && (
						<span className="ml-1 whitespace-nowrap text-xs text-muted">
							{index + 1} / {blocks.length}
						</span>
					)}
				</div>
			)}
		</div>
	);
}
