import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Button,
	Chip,
	CloseButton,
	DeleteIconButton,
	Input,
	Label,
	Modal,
	Spinner,
	Switch,
	Table,
	TextField,
	toast,
} from "@fluxify/components";
import { TbEdit, TbPlayerPlay, TbPlus, TbRoute } from "react-icons/tb";
import { routesQuery } from "@/query/routesQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { RouteApiPlayground } from "@/components/RouteApiPlayground";
import { createRouteHead } from "@/lib/seo";

export const Route = createFileRoute("/_authed/$projectId/routes")({
	head: createRouteHead(
		"API Routes",
		"Configure, inspect, and manage API routes and endpoints for your project.",
	),
	component: RoutesPage,
});

type RouteRow = {
	id: string;
	name?: string | null;
	method?: string | null;
	path?: string | null;
	active?: boolean | null;
};

function RoutesPage() {
	const { projectId } = Route.useParams();
	const navigate = useNavigate();
	const [page, setPage] = useState(1);
	const [search, setSearch] = useState("");
	const { data, isLoading, isError } = routesQuery.getAll.useQuery({
		projectId,
		page,
		perPage: 10,
	});
	const toggle = routesQuery.toggleActive.mutation();
	const remove = routesQuery.remove.mutation();
	const [pendingDelete, setPendingDelete] = useState<RouteRow | null>(null);
	const [pendingPlayground, setPendingPlayground] = useState<RouteRow | null>(null);

	const rows = useMemo(() => {
		const list = (data?.data ?? []) as RouteRow[];
		const query = search.trim().toLowerCase();
		if (!query) return list;
		return list.filter(
			(r) =>
				(r.name && r.name.toLowerCase().includes(query)) ||
				(r.path && r.path.toLowerCase().includes(query)) ||
				(r.method && r.method.toLowerCase().includes(query)),
		);
	}, [data?.data, search]);

	const totalPages = data?.pagination?.totalPages ?? 1;

	const openNew = () =>
		navigate({ to: "/$projectId/routes/new", params: { projectId } });

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Routes</h1>
					<p className="text-sm text-muted">
						Configure, inspect, and manage API routes and endpoints for your project.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<TextField
						value={search}
						onChange={(next) => {
							setSearch(next);
							setPage(1);
						}}
						className="w-56"
					>
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
					title={search ? `No route matches “${search}”` : "No routes yet"}
					description={
						search
							? "Try a different name or path."
							: "API routes handle HTTP requests for your project. Create your first endpoint to get started."
					}
					action={
						!search && (
							<Button variant="primary" onPress={openNew}>
								<TbPlus size={16} /> New route
							</Button>
						)
					}
				/>
			) : (
				<Table>
					<Table.Content aria-label="Routes">
					<Table.Header>
						<Table.Column id="method">Method</Table.Column>
						<Table.Column id="path" isRowHeader>Path</Table.Column>
						<Table.Column id="name">Name</Table.Column>
						<Table.Column id="status">Status</Table.Column>
						<Table.Column id="actions" aria-label="Actions">{""}</Table.Column>
					</Table.Header>
					<Table.Body items={rows}>
						{(route: RouteRow) => (
							<Table.Row id={route.id}>
								<Table.Cell>
									<Chip>{route.method}</Chip>
								</Table.Cell>
								<Table.Cell>
									<span className="font-mono text-sm">{route.path}</span>
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
											onPress={() =>
												navigate({
													to: "/$projectId/canvas/$routeId",
													params: { projectId, routeId: route.id },
												})
											}
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
			)}

			{totalPages > 1 && (
				<div className="flex items-center justify-end gap-3 text-sm text-muted">
					<Button variant="outline" isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
						Previous
					</Button>
					<span>Page {page} of {totalPages}</span>
					<Button variant="outline" isDisabled={page >= totalPages} onPress={() => setPage((p) => p + 1)}>
						Next
					</Button>
				</div>
			)}

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
										baseUrl={import.meta.env.VITE_ROUTE_BASE_URL ?? window.location.origin}
										isFramed={false}
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
				Delete{" "}
				<b className="text-foreground">{pendingDelete?.name || pendingDelete?.path}</b>?
				This can't be undone.
			</ConfirmDialog>
		</div>
	);
}
