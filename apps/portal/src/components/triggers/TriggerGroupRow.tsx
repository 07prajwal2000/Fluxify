import {
	Button,
	Chip,
	DeleteIconButton,
	Input,
	Label,
	TextField,
	toast,
} from "@fluxify/components";
import { useState } from "react";
import { TbBolt, TbCheck, TbEdit, TbLock, TbServer, TbX } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { triggersQuery } from "@/query/triggersQuery";
import type { TriggerGroup } from "@/services/triggers";

export type TriggerGroupRowProps = {
	projectId: string;
	group: TriggerGroup;
	onDelete: () => void;
};

/**
 * An individual trigger group card supporting inline editing and worker status visualization.
 */
export function TriggerGroupRow({ projectId, group, onDelete }: TriggerGroupRowProps) {
	const update = triggersQuery.updateGroup.mutation(projectId);
	const [editing, setEditing] = useState(false);
	const [name, setName] = useState(group.name);
	const [description, setDescription] = useState(group.description ?? "");

	const save = () => {
		const trimmedName = name.trim();
		if (trimmedName.length < 2) return;

		update.mutate(
			{
				id: group.id,
				name: trimmedName,
				description: description.trim() || null,
			},
			{
				onSuccess: () => {
					toast.success(`Group "${trimmedName}" updated`);
					setEditing(false);
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	};

	const cancelEdit = () => {
		setName(group.name);
		setDescription(group.description ?? "");
		setEditing(false);
	};

	if (editing) {
		return (
			<div
				className="rounded-xl border border-accent/50 bg-surface p-4 shadow-md transition-all flex flex-col gap-3"
				onKeyDown={(e) => {
					if (e.key === "Escape") cancelEdit();
				}}
			>
				<div className="flex items-center justify-between">
					<span className="text-xs font-semibold text-foreground">Editing {group.name}</span>
					<span className="text-[11px] text-muted">Press Esc to cancel</span>
				</div>

				<form
					className="flex flex-col gap-3"
					onSubmit={(e) => {
						e.preventDefault();
						save();
					}}
				>
					<TextField value={name} onChange={setName} autoFocus className="w-full">
						<Label className="text-xs font-medium mb-1">Group name</Label>
						<Input className="bg-surface-secondary/50" />
					</TextField>

					<TextField value={description} onChange={setDescription} className="w-full">
						<Label className="text-xs font-medium mb-1">Description (optional)</Label>
						<Input placeholder="Description" className="bg-surface-secondary/50" />
					</TextField>

					<div className="flex items-center justify-end gap-2 pt-1">
						<Button size="sm" variant="ghost" aria-label="Cancel editing" onPress={cancelEdit}>
							<TbX size={15} /> Cancel
						</Button>
						<Button
							type="submit"
							size="sm"
							variant="primary"
							aria-label="Save group changes"
							isPending={update.isPending}
							isDisabled={name.trim().length < 2}
						>
							<TbCheck size={15} /> Save changes
						</Button>
					</div>
				</form>
			</div>
		);
	}

	return (
		<div className="group flex flex-col gap-2 rounded-xl border border-border bg-surface-secondary/35 p-3.5 transition-all hover:border-border-hover hover:bg-surface-secondary/60">
			<div className="flex items-start justify-between gap-3">
				<div className="flex items-center gap-2.5 min-w-0">
					<div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface text-foreground border border-border/80 shadow-xs">
						{group.isDefault ? (
							<TbLock size={14} className="text-muted" />
						) : (
							<TbServer size={14} className="text-accent" />
						)}
					</div>
					<div className="flex items-center gap-2 min-w-0">
						<span className="truncate font-semibold text-sm text-foreground">{group.name}</span>
						{group.isDefault && (
							<Chip
								size="sm"
								variant="primary"
								className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5"
							>
								Default
							</Chip>
						)}
					</div>
				</div>

				<div className="flex items-center gap-2 shrink-0">
					<div className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-muted border border-border/60">
						<TbBolt size={12} className={group.triggerCount > 0 ? "text-accent" : "text-muted"} />
						<span>
							{group.triggerCount} {group.triggerCount === 1 ? "trigger" : "triggers"}
						</span>
					</div>

					{!group.isDefault ? (
						<div className="flex items-center gap-1">
							<Button
								isIconOnly
								size="sm"
								variant="ghost"
								aria-label={`Edit ${group.name}`}
								onPress={() => {
									setName(group.name);
									setDescription(group.description ?? "");
									setEditing(true);
								}}
							>
								<TbEdit size={15} />
							</Button>
							<DeleteIconButton size="sm" aria-label={`Delete ${group.name}`} onPress={onDelete} />
						</div>
					) : (
						<span
							className="text-[11px] text-muted italic pr-1"
							title="The default group is where triggers with no group land and cannot be deleted or renamed."
						>
							System
						</span>
					)}
				</div>
			</div>

			<div className="pl-9.5">
				{group.description ? (
					<p className="text-xs text-muted leading-relaxed line-clamp-2">{group.description}</p>
				) : (
					<p className="text-xs text-muted/50 italic">
						{group.isDefault
							? "Default worker pool for triggers without a specific group assigned."
							: "No description provided."}
					</p>
				)}
			</div>
		</div>
	);
}
