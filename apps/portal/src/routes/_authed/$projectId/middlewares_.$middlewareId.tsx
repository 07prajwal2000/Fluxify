import {
	Button,
	Input,
	Label,
	ReorderableList,
	Spinner,
	TextField,
	toast,
} from "@fluxify/components";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { TbArrowDown, TbArrowLeft, TbPlus } from "react-icons/tb";
import { CustomBlockIcon, type IconValue } from "@/components/customBlocks/IconPicker";
import { PickerModal } from "@/components/middlewares/PickerModal";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead, usePageTitle } from "@/lib/seo";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import type { Middleware } from "@/services/middlewares";

export const Route = createFileRoute("/_authed/$projectId/middlewares_/$middlewareId")({
	head: createRouteHead("Middleware", "Edit a middleware's chain of custom blocks."),
	component: MiddlewareEditorPage,
});

type ChainBlock = Middleware["blocks"][number];

const blockIcon = (block: { icon?: string | null; iconUrl?: string | null }) => (
	<CustomBlockIcon
		icon={(block.icon as IconValue["icon"]) ?? undefined}
		iconUrl={block.iconUrl ?? undefined}
	/>
);

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

function Editor({ projectId, middleware }: { projectId: string; middleware: Middleware }) {
	const update = middlewaresQuery.update.mutation(projectId, middleware.id);
	const { data: customBlocks } = customBlocksQuery.getAll.useQuery(projectId);
	const [name, setName] = useState(middleware.name);
	const [description, setDescription] = useState(middleware.description ?? "");
	const [chain, setChain] = useState<ChainBlock[]>(middleware.blocks);
	const [picking, setPicking] = useState(false);

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

	// only middleware blocks can be chained, and each one once
	const candidates = useMemo(
		() =>
			(customBlocks ?? [])
				.filter((b) => b.usage === "middleware")
				.map((b) => ({
					id: b.id,
					label: b.label || b.name,
					description: b.description,
					icon: blockIcon(b),
					disabledReason: chain.some((c) => c.id === b.id) ? "Already in this chain" : undefined,
					block: b,
				})),
		[customBlocks, chain],
	);

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
		<div className="flex max-w-2xl flex-col gap-6">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<Link
					to="/$projectId/middlewares"
					params={{ projectId }}
					className="flex items-center gap-1 text-sm text-muted hover:text-foreground"
				>
					<TbArrowLeft size={16} /> Middlewares
				</Link>
				<Button
					variant="primary"
					isDisabled={!isDirty || !name.trim()}
					isPending={update.isPending}
					onPress={save}
				>
					Save
				</Button>
			</div>

			<div className="flex flex-col gap-3">
				<TextField value={name} onChange={setName} isInvalid={!name.trim()}>
					<Label>Name</Label>
					<Input />
				</TextField>
				<TextField value={description} onChange={setDescription}>
					<Label>Description</Label>
					<Input placeholder="What this middleware does" />
				</TextField>
			</div>

			<section className="flex flex-col gap-2">
				<div>
					<h2 className="text-sm font-medium text-foreground">Chain</h2>
					<p className="text-xs text-muted">
						Runs top to bottom. Each block gets the previous block's output. A Response block ends
						the request right there.
					</p>
				</div>
				<ReorderableList
					items={chain}
					getKey={(b) => b.id}
					showIndex
					onReorder={(next) => setChain(next)}
					onRemove={(b) => setChain(chain.filter((c) => c.id !== b.id))}
					removeButtonAriaLabel="Remove from chain"
					renderItemContent={(b) => (
						<span className="flex min-w-0 items-center gap-2">
							{blockIcon(b)}
							<span className="truncate text-sm text-foreground">{b.label || b.name}</span>
						</span>
					)}
					emptyMessage="No blocks yet. Add the first one below."
				/>
				<div className="flex flex-col items-center gap-1 text-muted">
					{chain.length > 0 && <TbArrowDown size={16} aria-hidden />}
					<Button variant="secondary" size="sm" onPress={() => setPicking(true)}>
						<TbPlus size={14} /> Add block
					</Button>
				</div>
			</section>

			<PickerModal
				open={picking}
				onOpenChange={setPicking}
				title="Add a block to the chain"
				items={candidates}
				empty={
					<>
						No middleware blocks yet. Create a custom block and set <b>Used for</b> to{" "}
						<b>Middleware</b>.{" "}
						<Link
							to="/$projectId/custom-blocks/new"
							params={{ projectId }}
							className="text-accent hover:underline"
						>
							New custom block
						</Link>
					</>
				}
				onPick={(item) => {
					const b = candidates.find((c) => c.id === item.id)?.block;
					if (b)
						setChain([
							...chain,
							{
								...b,
								description: b.description ?? null,
								icon: b.icon ?? null,
								iconUrl: b.iconUrl ?? null,
							},
						]);
				}}
			/>
		</div>
	);
}
