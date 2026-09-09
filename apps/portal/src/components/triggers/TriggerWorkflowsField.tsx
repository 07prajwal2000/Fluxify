import { useState } from "react";
import { Button, DeleteIconButton, Spinner } from "@fluxify/components";
import { TbPlus, TbSitemap } from "react-icons/tb";
import { WorkflowSelectorModal } from "@/components/workflows/WorkflowField";
import { workflowsQuery } from "@/query/workflowsQuery";

/**
 * The workflows a trigger starts.
 *
 * A trigger is a source, and a source is worth pointing at more than one
 * workflow — each linked workflow gets its own run, so one failing does not
 * hold up the others. Picking is delegated to the same selector the canvas
 * uses, so a project with 400 workflows is still searchable.
 */
export function TriggerWorkflowsField({
	projectId,
	value,
	onChange,
}: {
	projectId: string;
	value: string[];
	onChange: (value: string[]) => void;
}) {
	const [picking, setPicking] = useState(false);

	return (
		<div className="flex flex-col gap-2">
			{value.length === 0 ? (
				<p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted">
					No workflows yet. A trigger with nothing attached is saved and idle —
					it starts firing as soon as you attach one.
				</p>
			) : (
				value.map((workflowId) => (
					<WorkflowRow
						key={workflowId}
						workflowId={workflowId}
						onRemove={() => onChange(value.filter((id) => id !== workflowId))}
					/>
				))
			)}

			<Button
				variant="outline"
				size="sm"
				className="self-start"
				onPress={() => setPicking(true)}
			>
				<TbPlus size={14} /> Add workflow
			</Button>

			<WorkflowSelectorModal
				projectId={projectId}
				isOpen={picking}
				onOpenChange={setPicking}
				onSelect={(id) => {
					// Selecting one already in the list is a no-op rather than a
					// duplicate row: the link is a set, and the server stores it as one.
					if (!value.includes(id)) onChange([...value, id]);
					setPicking(false);
				}}
			/>
		</div>
	);
}

function WorkflowRow({
	workflowId,
	onRemove,
}: {
	workflowId: string;
	onRemove: () => void;
}) {
	const { data, isLoading } = workflowsQuery.byId.useQuery(workflowId);

	return (
		<div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
			<TbSitemap size={16} className="shrink-0 text-muted" />
			<span className="min-w-0 flex-1 truncate text-sm text-foreground">
				{isLoading ? <Spinner size="sm" /> : (data?.name ?? workflowId)}
			</span>
			{data && !data.active && (
				<span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-warning">
					Inactive
				</span>
			)}
			<DeleteIconButton aria-label="Remove workflow" size="sm" onPress={onRemove} />
		</div>
	);
}
