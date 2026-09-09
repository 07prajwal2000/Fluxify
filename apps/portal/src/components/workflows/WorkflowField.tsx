import { useEffect, useMemo, useState } from "react";
import {
	Button,
	CloseButton,
	Input,
	Label,
	Modal,
	Spinner,
	Table,
	TextField,
	cn,
} from "@fluxify/components";
import { TbRefresh, TbRoute, TbSearch, TbSitemap } from "react-icons/tb";
import { withBasePath } from "@/constants/routes";
import { workflowsQuery } from "@/query/workflowsQuery";

/**
 * Picks a workflow by id, in the shape of the integration selector: a
 * fixed-height summary row with a button, and a table picker behind it. Ids are
 * stored rather than names so renaming a workflow cannot break a graph.
 */
export function WorkflowField({
	projectId,
	value,
	label,
	description,
	isDisabled,
	onChange,
}: {
	projectId: string;
	value: string;
	label?: string;
	description?: string;
	isDisabled?: boolean;
	onChange: (value: string) => void;
}) {
	const [pickerOpen, setPickerOpen] = useState(false);
	// Only to name the selection; the id is what the block stores.
	const { data: selected, isLoading } = workflowsQuery.byId.useQuery(value);

	return (
		<div className="flex flex-col gap-1.5 py-2">
			{label && (
				<span className="text-sm font-semibold text-foreground">{label}</span>
			)}
			{description && (
				<p className="text-xs leading-normal text-muted-foreground">
					{description}
				</p>
			)}

			<div className="flex h-10 w-full items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-surface px-3 shadow-sm">
				<div className="flex min-w-0 flex-1 items-center gap-2.5">
					{value && isLoading ? (
						<>
							<Spinner size="sm" />
							<span className="text-xs text-muted-foreground">Loading…</span>
						</>
					) : value ? (
						<>
							<TbSitemap size={18} className="shrink-0 text-foreground/70" />
							<span className="truncate text-sm font-medium text-foreground">
								{selected?.name ?? value}
							</span>
							{selected && !selected.active && (
								<span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
									Inactive
								</span>
							)}
						</>
					) : (
						<span className="text-sm text-muted-foreground">None selected</span>
					)}
				</div>

				<div className="flex shrink-0 items-center gap-1.5">
					{value && (
						<>
							<CloseButton
								aria-label="Clear workflow"
								isDisabled={isDisabled}
								onPress={() => onChange("")}
								className="text-muted-foreground hover:bg-surface-secondary hover:text-foreground"
							/>
							<span className="mx-1 h-5 w-px shrink-0 bg-border" />
						</>
					)}
					<Button
						variant="primary"
						size="sm"
						isDisabled={isDisabled}
						onPress={() => setPickerOpen(true)}
					>
						{value ? "Change" : "Select"}
					</Button>
				</div>
			</div>

			{selected && !selected.active && (
				<p className="text-xs leading-normal text-warning">
					This workflow is inactive, so a run queued for it will not start until
					you activate it.
				</p>
			)}

			<WorkflowSelectorModal
				projectId={projectId}
				isOpen={pickerOpen}
				onOpenChange={setPickerOpen}
				selectedId={value}
				onSelect={(id) => {
					onChange(id);
					setPickerOpen(false);
				}}
			/>
		</div>
	);
}

export function WorkflowSelectorModal({
	projectId,
	isOpen,
	onOpenChange,
	selectedId,
	onSelect,
}: {
	projectId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
	selectedId?: string;
	onSelect: (id: string) => void;
}) {
	const [search, setSearch] = useState("");

	useEffect(() => {
		if (isOpen) setSearch("");
	}, [isOpen]);

	// The list is small enough to filter here, which keeps typing instant and
	// costs no round trip per keystroke.
	const { data, isLoading, isFetching, refetch } =
		workflowsQuery.getAll.useQuery({ projectId, perPage: 100 });
	const workflows = useMemo(() => data?.data ?? [], [data?.data]);

	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		if (!query) return workflows;
		return workflows.filter(
			(workflow) =>
				(workflow.name ?? "").toLowerCase().includes(query) ||
				(workflow.description ?? "").toLowerCase().includes(query),
		);
	}, [workflows, search]);

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="lg">
					<Modal.Dialog
						className="flex max-h-[90vh] w-full flex-col !max-w-4xl"
						style={{ minHeight: "68vh", height: "72vh" }}
					>
						<Modal.Header className="shrink-0 border-b border-border/50 px-5 py-3.5 pb-2">
							<div className="flex w-full items-center justify-between">
								<div className="flex items-center gap-2.5">
									<div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-foreground">
										<TbSitemap className="size-4 text-foreground/80" />
									</div>
									<Modal.Heading className="text-sm font-semibold text-foreground">
										Choose Workflow
									</Modal.Heading>
								</div>
								<CloseButton onPress={() => onOpenChange(false)} />
							</div>
						</Modal.Header>

						<div className="flex shrink-0 items-center gap-2 px-5 py-3">
							<TextField value={search} onChange={setSearch} className="flex-1">
								<Label className="sr-only">Search workflows</Label>
								<Input placeholder="Search by name or description…" />
							</TextField>
							{/* A workflow created in the other tab is not here until asked
							    for again, and reopening the picker is not obvious. */}
							<Button
								aria-label="Refresh workflows"
								variant="outline"
								size="sm"
								isDisabled={isFetching}
								onPress={() => void refetch()}
							>
								{isFetching ? <Spinner size="sm" /> : <TbRefresh size={14} />}
							</Button>
						</div>

						<Modal.Body className="min-h-0 flex-1 overflow-y-auto p-0">
							{isLoading ? (
								<div className="flex h-full items-center justify-center">
									<Spinner />
								</div>
							) : workflows.length === 0 ? (
								<div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
									<span className="flex size-16 items-center justify-center rounded-full border border-border bg-surface-secondary text-muted-foreground">
										<TbRoute size={32} />
									</span>
									<div className="flex flex-col gap-1.5">
										<p className="text-sm font-semibold text-foreground">
											No workflows yet
										</p>
										<p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
											Create a workflow first, then come back and point this
											block at it.
										</p>
									</div>
									<Button
										variant="primary"
										size="sm"
										onPress={() =>
											window.open(
												withBasePath(`/${projectId}/workflows`),
												"_blank",
												"noopener,noreferrer",
											)
										}
									>
										Go to Workflows
									</Button>
								</div>
							) : filtered.length === 0 ? (
								<div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
									<TbSearch size={28} className="text-muted-foreground" />
									<p className="text-sm text-muted-foreground">
										No workflows match{" "}
										<strong className="text-foreground">"{search}"</strong>
									</p>
								</div>
							) : (
								<Table>
									<Table.Content aria-label="Workflows">
										<Table.Header className="bg-surface-secondary">
											<Table.Column id="icon" aria-label="Icon">
												{""}
											</Table.Column>
											<Table.Column id="name" isRowHeader>
												Name
											</Table.Column>
											<Table.Column id="description">Description</Table.Column>
											<Table.Column id="status">Status</Table.Column>
											<Table.Column id="action" aria-label="Action">
												{""}
											</Table.Column>
										</Table.Header>
										<Table.Body items={filtered}>
											{(workflow: (typeof filtered)[number]) => (
												<Table.Row
													id={workflow.id}
													className={cn(
														"cursor-pointer transition-colors",
														workflow.id === selectedId && "bg-accent/10",
													)}
												>
													<Table.Cell>
														<TbSitemap
															size={18}
															className="shrink-0 text-foreground/70"
														/>
													</Table.Cell>
													<Table.Cell>
														<span className="text-sm font-medium text-foreground">
															{workflow.name}
														</span>
													</Table.Cell>
													<Table.Cell>
														<span className="line-clamp-2 text-xs text-muted-foreground">
															{workflow.description || "—"}
														</span>
													</Table.Cell>
													<Table.Cell>
														<span
															className={cn(
																"inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
																workflow.active
																	? "border-success/40 bg-success/10 text-success"
																	: "border-border bg-surface-secondary text-muted-foreground",
															)}
														>
															{workflow.active ? "Active" : "Inactive"}
														</span>
													</Table.Cell>
													<Table.Cell>
														<div className="flex justify-end">
															<Button
																size="sm"
																variant={
																	workflow.id === selectedId
																		? "primary"
																		: "outline"
																}
																onPress={() => onSelect(workflow.id)}
															>
																{workflow.id === selectedId
																	? "Selected"
																	: "Select"}
															</Button>
														</div>
													</Table.Cell>
												</Table.Row>
											)}
										</Table.Body>
									</Table.Content>
								</Table>
							)}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
