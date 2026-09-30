import { Button, Input, Label, Spinner, TextField, toast } from "@fluxify/components";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { TbArrowLeft } from "react-icons/tb";
import { type ChainBlock, ChainEditor } from "@/components/middlewares/ChainEditor";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import type { Middleware } from "@/services/middlewares";

export const Route = createFileRoute("/_authed/$projectId/middlewares_/$middlewareId")({
	head: createRouteHead("Middleware", "Edit a middleware's chain of custom blocks."),
	component: MiddlewareEditorPage,
});

function MiddlewareEditorPage() {
	const { projectId, middlewareId } = Route.useParams();
	const { data, isLoading, isError } = middlewaresQuery.get.useQuery(middlewareId);
	usePageTitle(data ? `${data.name} | Middlewares` : "Middleware");

	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}
	if (isError || !data)
		return <p className="py-16 text-center text-muted">Couldn't load this middleware.</p>;
	return <Editor projectId={projectId} middleware={data} />;
}

function Card({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: ReactNode;
}) {
	return (
		<section className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5">
			<div>
				<h2 className="text-sm font-semibold text-foreground">{title}</h2>
				<p className="mt-0.5 text-xs text-muted">{description}</p>
			</div>
			{children}
		</section>
	);
}

function Editor({ projectId, middleware }: { projectId: string; middleware: Middleware }) {
	const navigate = useNavigate();
	const update = middlewaresQuery.update.mutation(projectId, middleware.id);
	const [name, setName] = useState(middleware.name);
	const [description, setDescription] = useState(middleware.description ?? "");
	const [chain, setChain] = useState<ChainBlock[]>(middleware.blocks);

	// a save refetches the middleware; start again from what the server holds
	useEffect(() => {
		setName(middleware.name);
		setDescription(middleware.description ?? "");
		setChain(middleware.blocks);
	}, [middleware]);

	const isDirty =
		name !== middleware.name ||
		description !== (middleware.description ?? "") ||
		chain.map((b) => b.id).join() !== middleware.blocks.map((b) => b.id).join();

	function save() {
		update.mutate(
			{
				name: name.trim(),
				description: description.trim() || null,
				blocks: chain.map((b) => b.id),
			},
			{
				onSuccess: () => toast.success("Middleware saved"),
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	return (
		<div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
			<div className="flex flex-wrap items-center gap-3">
				<Button
					isIconOnly
					variant="ghost"
					aria-label="Back to middlewares"
					onPress={() => navigate({ to: "/$projectId/middlewares", params: { projectId } })}
				>
					<TbArrowLeft size={18} />
				</Button>
				<div className="min-w-0 flex-1">
					<h1 className="truncate text-xl font-semibold tracking-tight">{middleware.name}</h1>
					<p className="text-xs text-muted">
						{isDirty ? "Unsaved changes" : "Changes apply to every route that uses it."}
					</p>
				</div>
				<Button
					variant="primary"
					isDisabled={!isDirty || !name.trim()}
					isPending={update.isPending}
					onPress={save}
				>
					Save
				</Button>
			</div>

			<div className="grid items-start gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
				<Card title="Details" description="How this middleware shows up in a route's settings.">
					<TextField value={name} onChange={setName} isRequired isInvalid={!name.trim()}>
						<Label>Name</Label>
						<Input />
					</TextField>
					<TextField value={description} onChange={setDescription}>
						<Label>Description</Label>
						<Input placeholder="What this middleware does" />
					</TextField>
				</Card>

				<Card
					title="Chain"
					description="Runs top to bottom. Each block gets the previous block's output. A Response block ends the request."
				>
					<ChainEditor projectId={projectId} chain={chain} onChange={setChain} />
				</Card>
			</div>
		</div>
	);
}
