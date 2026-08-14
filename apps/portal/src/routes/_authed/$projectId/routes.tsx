import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	Button,
	Chip,
	Spinner,
	Table,
	toast,
} from "@fluxify/components";
import { TbPlus, TbTrash } from "react-icons/tb";
import { routesQuery } from "@/query/routesQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
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
	const { data, isLoading, isError } = routesQuery.getAll.useQuery({
		projectId,
		page,
		perPage: 10,
	});
	const toggle = routesQuery.toggleActive.mutation();
	const remove = routesQuery.remove.mutation();
	const [pendingDelete, setPendingDelete] = useState<RouteRow | null>(null);

	const totalPages = data?.pagination?.totalPages ?? 1;

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between">
				<h1 className="text-xl font-semibold tracking-tight">Routes</h1>
				<Button
					variant="primary"
					onPress={() =>
						navigate({ to: "/$projectId/routes/new", params: { projectId } })
					}
				>
					<TbPlus size={16} /> New route
				</Button>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Couldn't load routes.</p>
			) : data && data.data.length === 0 ? (
				<p className="py-16 text-center text-muted">
					No routes yet. Create your first one.
				</p>
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
					<Table.Body items={(data?.data ?? []) as RouteRow[]}>
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
									<Chip>{route.active ? "Active" : "Inactive"}</Chip>
								</Table.Cell>
								<Table.Cell>
									<div className="flex items-center justify-end gap-2">
										<Button variant="primary" onPress={() => navigate({ to: "/$projectId/editor/$routeId", params: { projectId, routeId: route.id } })}>Open</Button>
										<Button
											variant="outline"
											onPress={() =>
												toggle.mutate(
													{ id: route.id, active: !route.active },
													{ onError: (e) => showErrorNotification(e as Error) },
												)
											}
										>
											{route.active ? "Disable" : "Enable"}
										</Button>
										<Button
											isIconOnly
											variant="ghost"
											aria-label="Delete route"
											onPress={() => setPendingDelete(route)}
										>
											<TbTrash size={16} />
										</Button>
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
