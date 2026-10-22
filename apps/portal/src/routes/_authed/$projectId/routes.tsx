import {
	Button,
	Chip,
	CloseButton,
	DeleteIconButton,
	Input,
	Label,
	ListBox,
	Modal,
	Select,
	Spinner,
	Switch,
	Table,
	TextField,
	toast,
} from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { TbChevronDown, TbEdit, TbPlayerPlay, TbPlus, TbRoute } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { RouteApiPlayground } from "@/components/RouteApiPlayground";
import { RecordingIndicator } from "@/components/recordings/RecordingControls";
import { showErrorNotification } from "@/lib/errorNotifier";
import { PAGE_SIZES, usePageSize } from "@/lib/pageSize";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { projectsQuery } from "@/query/projectsQuery";
import { routesQuery } from "@/query/routesQuery";

export const Route = createFileRoute("/_authed/$projectId/routes")({
	head: createRouteHead(
		"Routes",
		"Configure, inspect, and manage API routes and endpoints for your project.",
	),
	component: RoutesPage,
});

export type RouteRow = {
	id: string;
	name?: string | null;
	method?: string | null;
	path?: string | null;
	active?: boolean | null;
	recordExecution?: boolean | null;
	devRecordExecution?: boolean | null;
};

function RoutesPage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Routes"));
	const navigate = useNavigate();
	const [page, setPage] = useState(1);
	const [perPage, setPerPage] = usePageSize("routes");
	const [search, setSearch] = useState("");
	const [debouncedSearch, setDebouncedSearch] = useState("");

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch(search.trim());
			setPage(1);
		}, 300);
		return () => clearTimeout(timer);
	}, [search]);

	const { data, isLoading, isError } = routesQuery.getAll.useQuery({
		projectId,
		page,
		perPage,
		search: debouncedSearch,
	});
	const toggle = routesQuery.toggleActive.mutation();
	const remove = routesQuery.remove.mutation();
	const [pendingDelete, setPendingDelete] = useState<RouteRow | null>(null);
	const [pendingPlayground, setPendingPlayground] = useState<RouteRow | null>(null);

	const rows = (data?.data ?? []) as RouteRow[];

	const totalPages = data?.pagination?.totalPages ?? 1;

	const openCanvas = (routeId: string) =>
		navigate({ to: "/$projectId/canvas/$routeId", params: { projectId, routeId } });
	const openNew = () => navigate({ to: "/$projectId/routes/new", params: { projectId } });

	return (
		<div className="flex h-[calc(100vh-3rem)] flex-col gap-4 overflow-hidden">
			<div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Routes</h1>
					<p className="text-sm text-muted">
						Configure, inspect, and manage API routes and endpoints for your project.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<TextField value={search} onChange={setSearch} className="w-56">
						<Label className="sr-only">Search routes</Label>
						<Input placeholder="Search routes" />
					</TextField>
					<Button variant="primary" onPress={openNew}>
						<TbPlus size={16} /> New route
					</Button>
				</div>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Couldn't load routes.</p>
			) : rows.length === 0 ? (
				<EmptyState
					icon={<TbRoute size={28} />}
					title={debouncedSearch ? `No route matches “${debouncedSearch}”` : "No routes yet"}
					description={
						debouncedSearch
							? "Try a different name or path."
							: "API routes handle HTTP requests for your project. Create your first endpoint to get started."
					}
					action={
						!debouncedSearch && (
							<Button variant="primary" onPress={openNew}>
								<TbPlus size={16} /> New route
							</Button>
						)
					}
				/>
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto">
					<Table>
						<Table.Content aria-label="Routes" onRowAction={(key) => openCanvas(String(key))}>
							<Table.Header className="sticky top-0 z-10">
								<Table.Column id="method">Method</Table.Column>
								<Table.Column id="path" isRowHeader>
									Path
								</Table.Column>
								<Table.Column id="name">Name</Table.Column>
								<Table.Column id="status">Status</Table.Column>
								<Table.Column id="actions" aria-label="Actions">
									{""}
								</Table.Column>
							</Table.Header>
							<Table.Body items={rows}>
								{(route: RouteRow) => (
									<Table.Row id={route.id} className="cursor-pointer">
										<Table.Cell>
											<Chip>{route.method}</Chip>
										</Table.Cell>
										<Table.Cell>
											<div className="flex items-center gap-2">
												<span className="font-mono text-sm">{route.path}</span>
												<RecordingIndicator
													dev={route.devRecordExecution}
													prod={route.recordExecution}
												/>
											</div>
										</Table.Cell>
										<Table.Cell>{route.name}</Table.Cell>
										<Table.Cell>
											<Switch
												isSelected={Boolean(route.active)}
												onChange={(active) =>
													toggle.mutate(
														{ id: route.id, active },
														{
															onSuccess: () =>
																toast.success(active ? "Route enabled" : "Route disabled"),
															onError: (e) => showErrorNotification(e as Error),
														},
													)
												}
												label={route.active ? "Active" : "Inactive"}
											/>
										</Table.Cell>
										<Table.Cell>
											<div className="flex items-center justify-end gap-1">
												<Button
													isIconOnly
													variant="ghost"
													aria-label={`Edit ${route.name || route.path}`}
													onPress={() => openCanvas(route.id)}
												>
													<TbEdit size={16} />
												</Button>
												<Button
													variant="outline"
													isDisabled={!route.active}
													onPress={() => setPendingPlayground(route)}
												>
													<TbPlayerPlay size={16} /> Playground
												</Button>
												<DeleteIconButton
													aria-label="Delete route"
													onPress={() => setPendingDelete(route)}
												/>
											</div>
										</Table.Cell>
									</Table.Row>
								)}
							</Table.Body>
						</Table.Content>
					</Table>
				</div>
			)}

			<div className="flex shrink-0 items-center justify-end gap-3 text-sm text-muted">
				<span>Rows per page:</span>
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
						<Button variant="outline" isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
							Previous
						</Button>
						<span>
							Page {page} of {totalPages}
						</span>
						<Button
							variant="outline"
							isDisabled={page >= totalPages}
							onPress={() => setPage((p) => p + 1)}
						>
							Next
						</Button>
					</>
				)}
			</div>

			{pendingPlayground && (
				<Modal
					isOpen={!!pendingPlayground}
					onOpenChange={(open) => !open && setPendingPlayground(null)}
				>
					<Modal.Backdrop>
						<Modal.Container placement="center" size="cover" className="p-0">
							<Modal.Dialog className="flex h-[min(820px,86vh)] w-[min(1600px,96vw)] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50">
								<Modal.Header className="flex h-11 shrink-0 flex-row items-center border-b border-border px-4 py-0">
									<Modal.Heading className="text-sm font-semibold">
										API Playground — {pendingPlayground.name || pendingPlayground.path}
									</Modal.Heading>
									<CloseButton aria-label="Close API Playground" className="ml-auto" />
								</Modal.Header>
								<Modal.Body className="min-h-0 flex-1 p-0">
									<RouteApiPlayground
										key={pendingPlayground.id}
										routeId={pendingPlayground.id}
										isFramed={false}
										onOpenRecording={() => setPendingPlayground(null)}
									/>
								</Modal.Body>
							</Modal.Dialog>
						</Modal.Container>
					</Modal.Backdrop>
				</Modal>
			)}

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(o) => !o && setPendingDelete(null)}
				title="Delete route?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => toast.success("Route deleted"),
						onError: (e) => showErrorNotification(e as Error),
					});
					setPendingDelete(null);
				}}
			>
				Delete <b className="text-foreground">{pendingDelete?.name || pendingDelete?.path}</b>? This
				can't be undone.
			</ConfirmDialog>
		</div>
	);
}
