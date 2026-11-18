import {
	Button,
	Chip,
	CloseButton,
	DeleteIconButton,
	Dropdown,
	Input,
	Label,
	Modal,
	Spinner,
	Table,
	TextField,
	Tooltip,
	toast,
} from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	TbCheck,
	TbEdit,
	TbPackageExport,
	TbPlayerPlay,
	TbPlus,
	TbRoute,
	TbSortAscending,
	TbSortDescending,
} from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { EnvStatusChips } from "@/components/common/EnvStatusChips";
import { PageFooter } from "@/components/common/PageFooter";
import { RouteApiPlayground } from "@/components/RouteApiPlayground";
import { RecordingIndicator, RecordingLegend } from "@/components/recordings/RecordingControls";
import { ExportModal } from "@/components/transfer/ExportModal";
import { ImportButton } from "@/components/transfer/ImportButton";
import { showErrorNotification } from "@/lib/errorNotifier";
import { usePageSize } from "@/lib/pageSize";
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

type SortBy = "createdAt" | "updatedAt" | "name";
const SORT_OPTIONS: { value: SortBy; label: string }[] = [
	{ value: "createdAt", label: "Created" },
	{ value: "updatedAt", label: "Updated" },
	{ value: "name", label: "Name" },
];

export type RouteRow = {
	id: string;
	name?: string | null;
	method?: string | null;
	path?: string | null;
	active?: boolean | null;
	devActive?: boolean | null;
	/** production serves it: active, with a promoted version */
	inProduction?: boolean | null;
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
	// newest-created first, so toggling or editing a route never moves it (#723)
	const [sortBy, setSortBy] = useState<SortBy>("createdAt");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
	const [debouncedSearch, setDebouncedSearch] = useState("");

	useEffect(() => {
		const timer = setTimeout(() => {
			setDebouncedSearch((prev) => {
				const trimmed = search.trim();
				if (prev !== trimmed) {
					setPage(1);
					return trimmed;
				}
				return prev;
			});
		}, 300);
		return () => clearTimeout(timer);
	}, [search]);

	const { data, isLoading, isError } = routesQuery.getAll.useQuery({
		projectId,
		page,
		perPage,
		search: debouncedSearch,
		sortBy,
		sortOrder,
	});
	const remove = routesQuery.remove.mutation();
	const [pendingDelete, setPendingDelete] = useState<RouteRow | null>(null);
	const [pendingPlayground, setPendingPlayground] = useState<RouteRow | null>(null);
	const [pendingExport, setPendingExport] = useState<RouteRow | null>(null);

	const rows = (data?.data ?? []) as RouteRow[];
	const recordsDev = rows.some((r) => r.devRecordExecution);
	const recordsProd = rows.some((r) => r.recordExecution);

	const totalPages = data?.pagination?.totalPages ?? 1;

	// one button for the whole sort: pick the field and the direction from its menu
	const sortMenu = (
		<Dropdown>
			<Dropdown.Trigger>
				<Button
					isIconOnly
					size="sm"
					variant="outline"
					aria-label={`Sort routes, ${sortOrder === "desc" ? "descending" : "ascending"}`}
				>
					{sortOrder === "desc" ? <TbSortDescending size={16} /> : <TbSortAscending size={16} />}
				</Button>
			</Dropdown.Trigger>
			<Dropdown.Popover placement="bottom end" className="min-w-40">
				<Dropdown.Menu aria-label="Sort routes">
					<Dropdown.Section>
						{SORT_OPTIONS.map((o) => (
							<Dropdown.Item
								key={o.value}
								id={o.value}
								textValue={o.label}
								onAction={() => {
									setSortBy(o.value);
									setPage(1);
								}}
							>
								<span className="flex w-4 justify-center">
									{sortBy === o.value && <TbCheck size={14} />}
								</span>
								<Label>{o.label}</Label>
							</Dropdown.Item>
						))}
					</Dropdown.Section>
					<Dropdown.Section className="mt-0.5 border-t border-border pt-0.5">
						{(["asc", "desc"] as const).map((o) => (
							<Dropdown.Item
								key={o}
								id={o}
								textValue={o === "asc" ? "Ascending" : "Descending"}
								onAction={() => {
									setSortOrder(o);
									setPage(1);
								}}
							>
								<span className="flex w-4 justify-center">
									{sortOrder === o && <TbCheck size={14} />}
								</span>
								<Label>{o === "asc" ? "Ascending" : "Descending"}</Label>
							</Dropdown.Item>
						))}
					</Dropdown.Section>
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	);

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
					<ImportButton
						resourceType="route"
						projectId={projectId}
						onOpen={(routeId) =>
							navigate({ to: "/$projectId/canvas/$routeId", params: { projectId, routeId } })
						}
					/>
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
								<Table.Column id="actions" aria-label="Sort and actions">
									<div className="flex justify-end">{sortMenu}</div>
								</Table.Column>
							</Table.Header>
							<Table.Body items={rows}>
								{(route: RouteRow) => (
									<Table.Row id={route.id} className="cursor-pointer">
										<Table.Cell>
											{/* recording shows as dots in the method chip; the legend under the table names them (#941) */}
											<Chip>
												<span className="flex items-center gap-1.5">
													<RecordingIndicator
														compact
														dev={route.devRecordExecution}
														prod={route.recordExecution}
													/>
													{route.method}
												</span>
											</Chip>
										</Table.Cell>
										<Table.Cell>
											<span className="font-mono text-sm">{route.path}</span>
										</Table.Cell>
										<Table.Cell>{route.name}</Table.Cell>
										<Table.Cell>
											{/* production lights up only with a promoted version to serve (#739) */}
											<EnvStatusChips
												prod={Boolean(route.active)}
												dev={Boolean(route.devActive)}
												promoted={Boolean(route.inProduction)}
											/>
										</Table.Cell>
										<Table.Cell>
											<div className="flex items-center justify-end gap-1">
												<Tooltip>
													<Button
														isIconOnly
														variant="ghost"
														aria-label={`Edit ${route.name || route.path}`}
														onPress={() => openCanvas(route.id)}
													>
														<TbEdit size={16} />
													</Button>
													<Tooltip.Content>Edit route</Tooltip.Content>
												</Tooltip>
												<Tooltip>
													<Button
														isIconOnly
														variant="ghost"
														aria-label={`Export ${route.name || route.path}`}
														onPress={() => setPendingExport(route)}
													>
														<TbPackageExport size={16} />
													</Button>
													<Tooltip.Content>Export route</Tooltip.Content>
												</Tooltip>
												<Button
													variant="outline"
													isDisabled={!route.active}
													onPress={() => setPendingPlayground(route)}
												>
													<TbPlayerPlay size={16} /> Playground
												</Button>
												<Tooltip>
													<DeleteIconButton
														aria-label="Delete route"
														onPress={() => setPendingDelete(route)}
													/>
													<Tooltip.Content>Delete route</Tooltip.Content>
												</Tooltip>
											</div>
										</Table.Cell>
									</Table.Row>
								)}
							</Table.Body>
						</Table.Content>
					</Table>
				</div>
			)}

			<PageFooter
				page={page}
				totalPages={totalPages}
				perPage={perPage}
				onPage={setPage}
				onPerPage={(n) => {
					setPerPage(n);
					setPage(1);
				}}
			>
				<RecordingLegend dev={recordsDev} prod={recordsProd} />
			</PageFooter>

			<ExportModal
				resourceType="route"
				resource={pendingExport}
				onClose={() => setPendingExport(null)}
			/>

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
