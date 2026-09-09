import { useEffect, useState } from "react";
import {
	Button,
	CloseButton,
	Input,
	Label,
	Modal,
	Spinner,
	cn,
} from "@fluxify/components";
import { TbRoute, TbSearch } from "react-icons/tb";
import { workflowsQuery } from "@/query/workflowsQuery";

/**
 * Picks a workflow by id, the way `AppConfigField` picks a config key: a
 * read-only summary with a button, and a searchable modal behind it. Ids are
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
	const [open, setOpen] = useState(false);
	// Only to show a name beside the id; the id is what the block stores.
	const { data: selected } = workflowsQuery.byId.useQuery(value);

	return (
		<div className="flex flex-col gap-1.5 py-2">
			{label && <Label>{label}</Label>}
			{description && <p className="text-xs text-muted">{description}</p>}

			<div className="flex h-10 w-full items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-surface px-3 shadow-sm">
				<div className="flex min-w-0 flex-1 items-center gap-2.5">
					{value ? (
						<>
							<TbRoute size={16} className="shrink-0 text-muted" />
							<span className="truncate text-sm font-medium text-foreground">
								{selected?.name ?? value}
							</span>
						</>
					) : (
						<span className="text-sm text-muted">No workflow selected</span>
					)}
				</div>
				<div className="flex shrink-0 items-center gap-1.5">
					{value && !isDisabled && (
						<CloseButton
							aria-label="Clear workflow"
							onPress={() => onChange("")}
							className="text-muted hover:text-foreground"
						/>
					)}
					<Button
						variant="primary"
						size="sm"
						isDisabled={isDisabled}
						onPress={() => setOpen(true)}
					>
						{value ? "Change" : "Select"}
					</Button>
				</div>
			</div>

			<WorkflowSelectorModal
				projectId={projectId}
				isOpen={open}
				onOpenChange={setOpen}
				selectedId={value}
				onSelect={(id) => {
					onChange(id);
					setOpen(false);
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
	const [debounced, setDebounced] = useState("");

	useEffect(() => {
		const timer = setTimeout(() => setDebounced(search), 250);
		return () => clearTimeout(timer);
	}, [search]);

	useEffect(() => {
		if (isOpen) {
			setSearch("");
			setDebounced("");
		}
	}, [isOpen]);

	const { data, isLoading } = workflowsQuery.getAll.useQuery({
		projectId,
		perPage: 50,
		search: debounced || undefined,
	});
	const items = data?.data ?? [];

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="w-full !max-w-xl">
						<Modal.Header className="flex flex-col gap-3 px-6 pb-2 pt-5">
							<div className="flex items-start justify-between gap-3">
								<div className="min-w-0 flex-1">
									<Modal.Heading className="text-base font-semibold text-foreground">
										Select a workflow
									</Modal.Heading>
									<p className="mt-0.5 text-xs text-muted">
										The workflow this block queues. It runs on its own worker —
										this block does not wait for it.
									</p>
								</div>
								<CloseButton />
							</div>
							<div className="relative">
								<TbSearch
									size={15}
									className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
								/>
								<Input
									placeholder="Search workflows…"
									value={search}
									onChange={(e) => setSearch(e.currentTarget.value)}
									className="h-8 w-full pl-8 text-xs"
								/>
							</div>
						</Modal.Header>

						<Modal.Body className="px-6 pb-5 pt-2">
							{isLoading ? (
								<div className="flex justify-center py-14">
									<Spinner />
								</div>
							) : items.length === 0 ? (
								<div className="flex flex-col items-center rounded-xl border border-dashed border-border px-4 py-12 text-center">
									<TbRoute size={28} className="mb-2 text-muted" />
									<p className="text-sm font-medium text-foreground">
										No workflows found
									</p>
									<p className="mt-1 text-xs text-muted">
										Create one from the Workflows page first.
									</p>
								</div>
							) : (
								<div className="flex max-h-[420px] min-h-[200px] flex-col gap-2 overflow-y-auto pr-1">
									{items.map((workflow) => (
										<button
											key={workflow.id}
											type="button"
											onClick={() => onSelect(workflow.id)}
											className={cn(
												"flex w-full flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors",
												workflow.id === selectedId
													? "border-accent bg-accent/10 ring-1 ring-accent"
													: "border-border bg-surface hover:border-accent hover:bg-surface-secondary",
											)}
										>
											<span className="truncate text-sm font-medium text-foreground">
												{workflow.name}
												{!workflow.active && (
													<span className="ml-2 text-[10px] font-semibold uppercase tracking-wider text-muted">
														Inactive
													</span>
												)}
											</span>
											{workflow.description && (
												<span className="truncate text-xs text-muted">
													{workflow.description}
												</span>
											)}
										</button>
									))}
								</div>
							)}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
