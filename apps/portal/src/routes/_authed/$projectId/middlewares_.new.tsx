import { Input, Label, TextField, toast } from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FormWizard, SummaryItem } from "@/components/common/FormWizard";
import { blockIcon, type ChainBlock, ChainEditor } from "@/components/middlewares/ChainEditor";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead, formatProjectTitle, usePageTitle } from "@/lib/seo";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import { projectsQuery } from "@/query/projectsQuery";

export const Route = createFileRoute("/_authed/$projectId/middlewares_/new")({
	head: createRouteHead("New Middleware", "Create a middleware: a chain of custom blocks."),
	component: CreateMiddlewarePage,
});

function CreateMiddlewarePage() {
	const { projectId } = Route.useParams();
	const { data: project } = projectsQuery.byId.useQuery(projectId);
	usePageTitle(formatProjectTitle(project?.name, "New Middleware"));
	const navigate = useNavigate();
	const create = middlewaresQuery.create.mutation(projectId);

	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [chain, setChain] = useState<ChainBlock[]>([]);

	const toList = () => navigate({ to: "/$projectId/middlewares", params: { projectId } });

	function submit() {
		create.mutate(
			{
				name: name.trim(),
				description: description.trim() || undefined,
				blocks: chain.map((b) => b.id),
			},
			{
				onSuccess: () => {
					toast.success("Middleware created");
					toList();
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	return (
		<FormWizard
			title="Create a middleware"
			description="Steps that run before or after a route, like an API key check or logging."
			onBack={toList}
			submitLabel="Create middleware"
			isPending={create.isPending}
			onSubmit={submit}
			steps={[
				{
					key: "basics",
					label: "Basics",
					title: "Name the middleware",
					description: "This name is what you pick from a route's settings.",
					isValid: name.trim().length > 0,
					content: (
						<div className="grid gap-x-6 gap-y-5 md:grid-cols-2">
							<TextField isRequired value={name} onChange={setName} autoFocus>
								<Label>Name</Label>
								<Input placeholder="Require API key" />
							</TextField>
							<TextField value={description} onChange={setDescription}>
								<Label>Description</Label>
								<Input placeholder="What this middleware does" />
							</TextField>
						</div>
					),
				},
				{
					key: "chain",
					label: "Chain",
					title: "Build the chain",
					description:
						"Optional. Blocks run top to bottom, each getting the previous one's output. A Response block ends the request.",
					content: (
						<div className="mx-auto w-full max-w-xl">
							<ChainEditor projectId={projectId} chain={chain} onChange={setChain} />
						</div>
					),
				},
				{
					key: "review",
					label: "Review",
					title: "Review and create",
					description: "Attach it to routes afterwards, from a route's Settings → Middlewares.",
					content: (
						<div className="flex flex-col gap-4">
							<dl className="grid gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-2">
								<SummaryItem label="Name" value={name} />
								<SummaryItem label="Description" value={description || "None"} />
							</dl>
							<div>
								<p className="mb-2 text-[11px] uppercase tracking-wide text-muted">Chain</p>
								{chain.length === 0 ? (
									<p className="text-sm text-muted">Empty. You can add blocks later.</p>
								) : (
									<ol className="flex flex-wrap items-center gap-2">
										{chain.map((b, i) => (
											<li
												key={b.id}
												className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
											>
												<span className="text-xs text-muted">{i + 1}</span>
												{blockIcon(b)}
												{b.label || b.name}
											</li>
										))}
									</ol>
								)}
							</div>
						</div>
					),
				},
			]}
		/>
	);
}
