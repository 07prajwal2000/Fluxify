import {
	Button,
	DeleteIconButton,
	Input,
	Label,
	Spinner,
	Table,
	TextField,
	toast,
} from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TbEdit, TbFilter, TbPlus, TbSearch } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { blockIcon } from "@/components/middlewares/ChainEditor";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import { projectsQuery } from "@/query/projectsQuery";
import type { MiddlewareSummary } from "@/services/middlewares";

export const Route = createFileRoute("/_authed/$projectId/middlewares")({
	head: createRouteHead("Middlewares", "Reusable steps that run before or after your routes."),
	component: MiddlewaresPage,
});

const DOCS_URL = "https://docs.fluxify.rest/concepts/middlewares.html";
/** chain icons shown in a row before collapsing into "+N" */
const MAX_ICONS = 5;

function MiddlewaresPage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Middlewares"));
	const { data, isLoading, isError } = middlewaresQuery.getAll.useQuery(projectId);
	const remove = middlewaresQuery.remove.mutation(projectId);
	const navigate = useNavigate();
	const [search, setSearch] = useState("");
	const [pendingDelete, setPendingDelete] = useState<MiddlewareSummary | null>(null);

	const rows = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!data || !q) return data ?? [];
		return data.filter((m) =>
			[m.name, m.description ?? ""].some((v) => v.toLowerCase().includes(q)),
		);
	}, [data, search]);

	const openNew = () => navigate({ to: "/$projectId/middlewares/new", params: { projectId } });
	const open = (middlewareId: string) =>
		navigate({ to: "/$projectId/middlewares/$middlewareId", params: { projectId, middlewareId } });

	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h1 className="text-xl font-semibold tracking-tight">Middlewares</h1>
					<p className="text-sm text-muted">
						Steps that run before or after a route, like auth checks or logging.{" "}
						<a
							href={DOCS_URL}
							target="_blank"
							rel="noreferrer"
							className="text-accent hover:underline"
						>
							How middlewares work
						</a>
					</p>
				</div>
				<div className="flex items-center gap-2">
					{data && data.length > 0 && (
						<TextField value={search} onChange={setSearch} className="w-56">
							<Label className="sr-only">Search middlewares</Label>
							<Input placeholder="Search middlewares" />
						</TextField>
					)}
					<Button variant="primary" onPress={openNew}>
						<TbPlus size={16} /> New middleware
					</Button>
				</div>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Couldn't load middlewares.</p>
			) : !data || data.length === 0 ? (
				<EmptyState
					icon={<TbFilter size={28} />}
					title="No middlewares yet"
					description="Build a check once, like an API key guard, and attach it to any route."
					action={
						<Button variant="primary" onPress={openNew}>
							<TbPlus size={16} /> New middleware
						</Button>
					}
				/>
			) : rows.length === 0 ? (
				<EmptyState
					icon={<TbSearch size={28} />}
					title={`No middleware matches “${search}”`}
					description="Try a different name or description."
				/>
			) : (
				<Table>
					<Table.Content aria-label="Middlewares" onRowAction={(key) => open(String(key))}>
						<Table.Header>
							<Table.Column id="name" isRowHeader>
								Name
							</Table.Column>
							<Table.Column id="chain">Chain</Table.Column>
							<Table.Column id="routes">Used by</Table.Column>
							<Table.Column id="actions" aria-label="Actions">
								{""}
							</Table.Column>
						</Table.Header>
						<Table.Body items={rows}>
							{(middleware) => (
								<Table.Row id={middleware.id} className="cursor-pointer">
									<Table.Cell>
										<span className="block font-medium text-foreground">{middleware.name}</span>
										<span className="line-clamp-1 text-xs text-muted">
											{middleware.description || "No description"}
										</span>
									</Table.Cell>
									<Table.Cell>
										<ChainPreview blocks={middleware.blocks} />
									</Table.Cell>
									<Table.Cell>
										<span
											className={
												middleware.routeCount ? "text-sm text-foreground" : "text-sm text-muted"
											}
										>
											{middleware.routeCount === 0
												? "No routes"
												: `${middleware.routeCount} route${middleware.routeCount === 1 ? "" : "s"}`}
										</span>
									</Table.Cell>
									<Table.Cell>
										<div className="flex items-center justify-end gap-1">
											<Button
												isIconOnly
												variant="ghost"
												aria-label={`Edit ${middleware.name}`}
												onPress={() => open(middleware.id)}
											>
												<TbEdit size={16} />
											</Button>
											<DeleteIconButton
												aria-label={`Delete ${middleware.name}`}
												onPress={() => setPendingDelete(middleware)}
											/>
										</div>
									</Table.Cell>
								</Table.Row>
							)}
						</Table.Body>
					</Table.Content>
				</Table>
			)}

			<ConfirmDialog
				open={!!pendingDelete}
				onOpenChange={(o) => !o && setPendingDelete(null)}
				title="Delete middleware?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingDelete) return;
					remove.mutate(pendingDelete.id, {
						onSuccess: () => toast.success("Middleware deleted"),
						onError: (e) => showErrorNotification(e as Error),
					});
					setPendingDelete(null);
				}}
			>
				Delete <b className="text-foreground">{pendingDelete?.name}</b>?
				{pendingDelete?.routeCount
					? ` It is removed from the ${pendingDelete.routeCount} route${pendingDelete.routeCount === 1 ? "" : "s"} that use it.`
					: " No route uses it."}
			</ConfirmDialog>
		</div>
	);
}

/** the chain's block icons in run order, each labelled on hover */
function ChainPreview({ blocks }: { blocks: MiddlewareSummary["blocks"] }) {
	if (blocks.length === 0) return <span className="text-sm text-muted">Empty</span>;
	const extra = blocks.length - MAX_ICONS;
	return (
		<div className="flex items-center gap-1">
			{blocks.slice(0, MAX_ICONS).map((b) => (
				<span
					key={b.id}
					title={b.label || b.name}
					role="img"
					aria-label={b.label || b.name}
					className="flex rounded-md border border-border bg-surface-secondary p-1"
				>
					{blockIcon(b)}
				</span>
			))}
			{extra > 0 && <span className="text-xs text-muted">+{extra}</span>}
		</div>
	);
}
