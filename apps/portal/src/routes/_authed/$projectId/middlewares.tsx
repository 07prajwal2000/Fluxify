import {
	Button,
	CloseButton,
	DeleteIconButton,
	Input,
	Label,
	Modal,
	Spinner,
	TextField,
	toast,
} from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { TbFilter, TbPlus } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
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

function MiddlewaresPage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "Middlewares"));
	const { data, isLoading, isError } = middlewaresQuery.getAll.useQuery(projectId);
	const remove = middlewaresQuery.remove.mutation(projectId);
	const navigate = useNavigate();
	const [creating, setCreating] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<MiddlewareSummary | null>(null);

	const open = (middlewareId: string) =>
		navigate({ to: "/$projectId/middlewares/$middlewareId", params: { projectId, middlewareId } });

	return (
		<div className="flex flex-col gap-5">
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
				<Button variant="primary" onPress={() => setCreating(true)}>
					<TbPlus size={16} /> New middleware
				</Button>
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
				/>
			) : (
				<ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-surface">
					{data.map((middleware) => (
						<li key={middleware.id} className="group flex items-center gap-3 px-4 py-3">
							<button
								type="button"
								onClick={() => open(middleware.id)}
								className="min-w-0 flex-1 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
							>
								<span className="block truncate text-sm font-medium text-foreground">
									{middleware.name}
								</span>
								<span className="block truncate text-xs text-muted">
									{middleware.description || "No description"}
								</span>
							</button>
							<div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
								<DeleteIconButton
									aria-label={`Delete ${middleware.name}`}
									onPress={() => setPendingDelete(middleware)}
								/>
							</div>
						</li>
					))}
				</ul>
			)}

			<CreateMiddlewareModal
				open={creating}
				onOpenChange={setCreating}
				projectId={projectId}
				onCreated={open}
			/>

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
				Delete <b className="text-foreground">{pendingDelete?.name}</b>? It is also removed from
				every route that uses it.
			</ConfirmDialog>
		</div>
	);
}

function CreateMiddlewareModal({
	open,
	onOpenChange,
	projectId,
	onCreated,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	projectId: string;
	onCreated: (id: string) => void;
}) {
	const create = middlewaresQuery.create.mutation(projectId);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	function submit() {
		create.mutate(
			{ name: name.trim(), description: description.trim() || undefined },
			{
				onSuccess: ({ id }) => {
					toast.success("Middleware created");
					onOpenChange(false);
					onCreated(id);
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	return (
		<Modal isOpen={open} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header className="flex flex-row items-center justify-between">
							<Modal.Heading>New middleware</Modal.Heading>
							<CloseButton />
						</Modal.Header>
						<Modal.Body className="flex flex-col gap-3">
							<TextField value={name} onChange={setName} autoFocus>
								<Label>Name</Label>
								<Input placeholder="Require API key" />
							</TextField>
							<TextField value={description} onChange={setDescription}>
								<Label>Description</Label>
								<Input placeholder="What this middleware does" />
							</TextField>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="ghost" onPress={() => onOpenChange(false)}>
								Cancel
							</Button>
							<Button
								variant="primary"
								isDisabled={!name.trim()}
								isPending={create.isPending}
								onPress={submit}
							>
								Create
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
