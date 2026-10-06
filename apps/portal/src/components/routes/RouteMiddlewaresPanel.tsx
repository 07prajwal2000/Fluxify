import { Button, ReorderableList, Spinner } from "@fluxify/components";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { TbFilter, TbPlus } from "react-icons/tb";
import { Section } from "@/components/common/Section";
import { PickerModal } from "@/components/middlewares/PickerModal";
import { showErrorNotification } from "@/lib/errorNotifier";
import { middlewaresQuery } from "@/query/middlewaresQuery";
import type { RouteMiddlewares } from "@/services/middlewares";

type Phase = keyof RouteMiddlewares;
type Item = RouteMiddlewares[Phase][number];

const DOCS_URL = "https://docs.fluxify.rest/concepts/middlewares.html";

const PHASES: { phase: Phase; title: string; description: string }[] = [
	{
		phase: "before",
		title: "Before the route",
		description:
			"Run in order before the route's own flow. One that ends in a Response block answers the request, and the route does not run.",
	},
	{
		phase: "after",
		title: "After the route",
		description:
			"Only for changing the reply, like headers or the body. They get { httpCode, body }; without a Response block the reply becomes a 200 with the last block's output.",
	},
];

/**
 * A route's middlewares (#534). Saves on every change — it has its own
 * endpoint, so tying it to the modal's Save would only add a second dirty state.
 */
export function RouteMiddlewaresPanel({
	routeId,
	projectId,
	readOnly = false,
}: {
	routeId: string;
	projectId: string;
	readOnly?: boolean;
}) {
	const { data, isLoading } = middlewaresQuery.forRoute.useQuery(routeId);
	const { data: all } = middlewaresQuery.getAll.useQuery(projectId);
	const save = middlewaresQuery.forRoute.mutation(routeId);
	const [adding, setAdding] = useState<Phase | null>(null);

	const attached = useMemo(
		() => new Set([...(data?.before ?? []), ...(data?.after ?? [])].map((m) => m.id)),
		[data],
	);
	const candidates = useMemo(
		() =>
			(all ?? []).map((m) => ({
				id: m.id,
				label: m.name,
				description: m.description,
				meta: `${m.blocks.length} block${m.blocks.length === 1 ? "" : "s"}`,
				disabledReason: attached.has(m.id) ? "Already on this route" : undefined,
			})),
		[all, attached],
	);

	if (isLoading || !data) {
		return (
			<div className="flex justify-center py-10">
				<Spinner />
			</div>
		);
	}

	function update(phase: Phase, next: Item[]) {
		const lists = { ...data!, [phase]: next };
		save.mutate(
			{ before: lists.before.map((m) => m.id), after: lists.after.map((m) => m.id) },
			{ onError: (e) => showErrorNotification(e as Error) },
		);
	}

	return (
		<>
			<p className="mb-4 text-xs text-muted">
				Changes save right away.{" "}
				<a href={DOCS_URL} target="_blank" rel="noreferrer" className="text-accent hover:underline">
					How middlewares work
				</a>
			</p>
			{PHASES.map(({ phase, title, description }) => (
				<Section key={phase} title={title} description={description}>
					<div className="flex flex-col gap-2">
						<ReorderableList
							items={data[phase]}
							getKey={(m) => m.id}
							getItemLabel={(m) => m.name}
							showIndex
							isEditable={!readOnly && !save.isPending}
							onReorder={(next) => update(phase, next)}
							onRemove={(m) =>
								update(
									phase,
									data[phase].filter((x) => x.id !== m.id),
								)
							}
							removeButtonAriaLabel="Remove middleware"
							emptyMessage="None"
						/>
						{!readOnly && (
							<Button
								variant="secondary"
								size="sm"
								className="w-fit"
								onPress={() => setAdding(phase)}
							>
								<TbPlus size={14} /> Add middleware
							</Button>
						)}
					</div>
				</Section>
			))}

			<PickerModal
				open={adding !== null}
				onOpenChange={(open) => !open && setAdding(null)}
				title={adding === "after" ? "Run after the route" : "Run before the route"}
				description={
					adding === "after"
						? "Pick a middleware to change the reply once the route has answered."
						: "Pick a middleware to run before the route, like an auth check."
				}
				icon={<TbFilter size={20} />}
				searchPlaceholder="Search middlewares…"
				items={candidates}
				empty={
					<>
						No middlewares in this project yet.{" "}
						<Link
							to="/$projectId/middlewares"
							params={{ projectId }}
							className="text-accent hover:underline"
						>
							Create one
						</Link>
					</>
				}
				onPick={(item) => {
					if (!adding) return;
					update(adding, [
						...data[adding],
						{ id: item.id, name: item.label, description: item.description ?? null },
					]);
				}}
			/>
		</>
	);
}
