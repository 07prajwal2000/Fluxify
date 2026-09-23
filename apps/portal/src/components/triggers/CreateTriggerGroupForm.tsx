import { Button, Input, Label, TextField, toast } from "@fluxify/components";
import { SLUG_HINT, SLUG_MAX, SLUG_PATTERN } from "@fluxify/lib/slug";
import { useState } from "react";
import { TbInfoCircle, TbPlus, TbX } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { triggersQuery } from "@/query/triggersQuery";

export type CreateTriggerGroupFormProps = {
	projectId: string;
	onSuccess: () => void;
	onCancel: () => void;
};

/**
 * Dedicated form card for creating a new trigger group with validation and worker pool info.
 */
export function CreateTriggerGroupForm({
	projectId,
	onSuccess,
	onCancel,
}: CreateTriggerGroupFormProps) {
	const create = triggersQuery.createGroup.mutation();
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");

	const trimmedName = name.trim();
	const nameValid =
		trimmedName.length >= 2 && trimmedName.length <= SLUG_MAX && SLUG_PATTERN.test(trimmedName);

	const submit = () => {
		if (!nameValid) return;

		create.mutate(
			{
				projectId,
				name: trimmedName,
				description: description.trim() || undefined,
			},
			{
				onSuccess: () => {
					toast.success(`Group "${trimmedName}" created`);
					setName("");
					setDescription("");
					onSuccess();
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	};

	return (
		<div className="rounded-xl border border-accent/40 bg-surface-secondary/60 p-4.5 shadow-sm transition-all animate-in fade-in-50 duration-200">
			<div className="flex items-center justify-between mb-3.5">
				<div className="flex items-center gap-2">
					<div className="flex size-6 items-center justify-center rounded-md bg-accent/20 text-accent">
						<TbPlus size={14} />
					</div>
					<span className="text-sm font-semibold text-foreground">Create trigger group</span>
				</div>
				<Button
					isIconOnly
					size="sm"
					variant="ghost"
					aria-label="Cancel group creation"
					onPress={onCancel}
				>
					<TbX size={15} />
				</Button>
			</div>

			<form
				className="flex flex-col gap-3.5"
				onSubmit={(e) => {
					e.preventDefault();
					submit();
				}}
				onKeyDown={(e) => {
					if (e.key === "Escape") onCancel();
				}}
			>
				<TextField
					value={name}
					onChange={setName}
					autoFocus
					className="w-full"
					isRequired
					isInvalid={trimmedName !== "" && !nameValid}
				>
					<div className="flex items-center justify-between mb-1">
						<Label className="text-xs font-medium">Group name</Label>
						<span className="text-[11px] text-muted">Cannot be changed later</span>
					</div>
					<Input
						placeholder="e.g. priority-webhooks"
						maxLength={SLUG_MAX}
						className="bg-surface font-mono"
					/>
					<p className="text-[11px] text-muted mt-1">
						2 to {SLUG_MAX} characters: {SLUG_HINT}.
					</p>
				</TextField>

				<TextField value={description} onChange={setDescription} className="w-full">
					<Label className="text-xs font-medium mb-1">Description (optional)</Label>
					<Input
						placeholder="e.g. Dedicated worker nodes for latency-sensitive webhooks"
						className="bg-surface"
					/>
				</TextField>

				<div className="flex items-center gap-2 rounded-lg bg-surface/70 px-3 py-2 text-[11px] text-muted border border-border/50">
					<TbInfoCircle size={15} className="shrink-0 text-accent" />
					<span>A dedicated worker pool will be provisioned when triggers run in this group.</span>
				</div>

				<div className="flex items-center justify-end gap-2 pt-1">
					<Button size="sm" variant="ghost" onPress={onCancel}>
						Cancel
					</Button>
					<Button
						type="submit"
						size="sm"
						variant="primary"
						isPending={create.isPending}
						isDisabled={!nameValid}
					>
						<TbPlus size={15} /> Create group
					</Button>
				</div>
			</form>
		</div>
	);
}
