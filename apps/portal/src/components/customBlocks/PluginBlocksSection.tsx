import { Button, ListBox, Select, Spinner, Table } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { TbChevronDown, TbChevronRight } from "react-icons/tb";
import { ApprovalBadge, Badge, StatusBadge } from "@/components/settings/plugins/PluginBadges";
import { PluginBlockIcon } from "@/components/settings/plugins/pluginBlockIcon";
import { PAGE_SIZES, usePageSize } from "@/lib/pageSize";
import { pluginsQuery } from "@/query/pluginsQuery";
import { type PluginBlock, type PluginBlockGroup, pluginBlockGroups } from "./pluginBlocks";

type Row = { id: string; group: PluginBlockGroup; block?: PluginBlock };

/**
 * The blocks plugins ship, under the Custom Blocks list (#862). They have no
 * custom-block rows, so they cannot be opened, versioned or deleted here: each
 * type (`scope/name/folder`) is a row that expands to its blocks, and links to
 * its plugin's page, where they are managed. `search` is the page's search box.
 */
export function PluginBlocksSection({
	projectId,
	search,
	hidden,
}: {
	projectId: string;
	search: string;
	/** a usage filter is on: plugin blocks have no usage, so none match */
	hidden: boolean;
}) {
	const { data, isLoading } = pluginsQuery.list.useQuery(projectId);
	const [page, setPage] = useState(1);
	const [perPage, setPerPage] = usePageSize("pluginBlocks");
	// one type open at a time; undefined until the user picks: then the first one is open
	const [open, setOpen] = useState<string | null>();
	if (hidden) return null;
	if (isLoading) return <Spinner size="sm" />;

	const groups = pluginBlockGroups(data ?? [], search);
	const totalPages = Math.max(1, Math.ceil(groups.length / perPage));
	const current = Math.min(page, totalPages);
	const expanded = open === undefined ? groups[0]?.key : open;
	const toggle = (key: string) => setOpen(expanded === key ? null : key);

	const rows: Row[] = groups
		.slice((current - 1) * perPage, current * perPage)
		.flatMap((group) => [
			{ id: `g:${group.key}`, group },
			...(expanded === group.key
				? group.blocks.map((block) => ({ id: `b:${block.name}`, group, block }))
				: []),
		]);

	return (
		<section aria-label="Plugin blocks" className="flex flex-col gap-3">
			<h2 className="text-sm font-semibold text-foreground">Plugin blocks</h2>
			{!groups.length ? (
				<p className="text-sm text-muted">No plugin block is loaded in this project.</p>
			) : (
				<>
					{/* fixed height: the rows scroll inside it, the header stays */}
					<div className="h-96 overflow-y-auto">
						<Table>
							<Table.Content aria-label="Plugin blocks">
								<Table.Header className="sticky top-0 z-10">
									<Table.Column id="type" isRowHeader>
										Type
									</Table.Column>
									<Table.Column id="status">Status</Table.Column>
									<Table.Column id="blocks">Blocks</Table.Column>
									<Table.Column id="actions" aria-label="Actions">
										{""}
									</Table.Column>
								</Table.Header>
								<Table.Body items={rows}>
									{({ id, group, block }: Row) =>
										block ? (
											<Table.Row id={id}>
												<Table.Cell>
													<div className="flex items-center gap-3 pl-8">
														<PluginBlockIcon block={block} />
														<div className="flex min-w-0 flex-col">
															<span className="truncate text-sm font-medium text-foreground">
																{block.label}
															</span>
															<span className="truncate font-mono text-xs text-muted">
																{block.name}
															</span>
														</div>
													</div>
												</Table.Cell>
												<Table.Cell>
													<div className="flex items-center gap-2 text-xs text-muted">
														{block.shape} shape
														{block.deprecated && <Badge tone="warning">Deprecated</Badge>}
													</div>
												</Table.Cell>
												<Table.Cell>{""}</Table.Cell>
												<Table.Cell>{""}</Table.Cell>
											</Table.Row>
										) : (
											<Table.Row id={id}>
												<Table.Cell>
													<Button
														variant="ghost"
														size="sm"
														aria-expanded={expanded === group.key}
														onPress={() => toggle(group.key)}
													>
														{expanded === group.key ? (
															<TbChevronDown size={14} />
														) : (
															<TbChevronRight size={14} />
														)}
														<code className="font-mono text-xs">{group.key}</code>
													</Button>
												</Table.Cell>
												<Table.Cell>
													<div className="flex items-center gap-2">
														<ApprovalBadge plugin={group.plugin} />
														<StatusBadge plugin={group.plugin} />
													</div>
												</Table.Cell>
												<Table.Cell>
													<span className="text-sm text-muted">{group.blocks.length}</span>
												</Table.Cell>
												<Table.Cell>
													<div className="flex justify-end">
														<Link
															to="/$projectId/settings"
															params={{ projectId }}
															search={{ tab: "plugins", plugin: group.plugin.name }}
															className="text-xs font-medium text-accent hover:underline"
														>
															Open plugin
														</Link>
													</div>
												</Table.Cell>
											</Table.Row>
										)
									}
								</Table.Body>
							</Table.Content>
						</Table>
					</div>

					<div className="flex items-center gap-3 text-sm text-muted">
						<span className="ml-auto">Rows per page:</span>
						<Select
							aria-label="Rows per page"
							value={String(perPage)}
							onChange={(v) => {
								if (!v) return;
								setPerPage(Number(v));
								setPage(1);
							}}
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
								<Button
									variant="outline"
									isDisabled={current <= 1}
									onPress={() => setPage(current - 1)}
								>
									Previous
								</Button>
								<span>
									Page {current} of {totalPages}
								</span>
								<Button
									variant="outline"
									isDisabled={current >= totalPages}
									onPress={() => setPage(current + 1)}
								>
									Next
								</Button>
							</>
						)}
					</div>
				</>
			)}
		</section>
	);
}
