import { useState } from "react";
import {
	Button,
	Modal,
	toast,
} from "@fluxify/components";
import { TbAlertTriangle, TbInfoCircle } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { GroupSelect } from "@/components/triggers/triggerForm";
import { triggersQuery } from "@/query/triggersQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { DeleteGroupOptions, TriggerGroup } from "@/services/triggers";

export type DeleteGroupDialogProps = {
	projectId: string;
	group: TriggerGroup | null;
	groups: TriggerGroup[];
	onClose: () => void;
};

/**
 * A group with triggers asks where they go — another group, or nowhere. Either
 * way, worker nodes that served only this group are scaled to zero and drain safely.
 */
export function DeleteGroupDialog({
	projectId,
	group,
	groups,
	onClose,
}: DeleteGroupDialogProps) {
	const remove = triggersQuery.deleteGroup.mutation(projectId);
	const others = groups.filter((other) => other.id !== group?.id);
	const [moveTo, setMoveTo] = useState("");
	const target = moveTo || others.find((other) => other.isDefault)?.id || "";

	const run = (options: DeleteGroupOptions) => {
		if (!group) return;
		remove.mutate(
			{ id: group.id, options },
			{
				onSuccess: ({ drainedClaims }) => {
					toast.success(
						drainedClaims
							? `Group "${group.name}" deleted. ${drainedClaims} worker claim(s) served only this group and are draining.`
							: `Group "${group.name}" deleted`,
					);
					setMoveTo("");
					onClose();
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	};

	const drainNote =
		"Worker nodes that serve only this group are scaled to 0 and drained safely.";

	if (!group || group.triggerCount === 0) {
		return (
			<ConfirmDialog
				open={Boolean(group)}
				onOpenChange={(open) => !open && onClose()}
				title={`Delete group "${group?.name}"?`}
				danger
				confirmText="Delete group"
				pending={remove.isPending}
				onConfirm={() => run({})}
			>
				<p>
					Are you sure you want to delete <b className="text-foreground">{group?.name}</b>? {drainNote}
				</p>
			</ConfirmDialog>
		);
	}

	return (
		<Modal isOpen onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog className="flex flex-col gap-4 p-5">
						<Modal.Header className="flex items-center gap-3">
							<div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-danger/10 text-danger ring-1 ring-danger/20">
								<TbAlertTriangle size={18} />
							</div>
							<div>
								<Modal.Heading className="text-base font-semibold text-foreground">
									Delete group “{group.name}”?
								</Modal.Heading>
								<span className="text-xs text-muted">
									{group.triggerCount} active {group.triggerCount === 1 ? "trigger" : "triggers"} assigned
								</span>
							</div>
						</Modal.Header>

						<Modal.Body className="flex flex-col gap-3.5 text-sm text-muted">
							<p className="leading-relaxed">
								This group still has <b className="text-foreground">{group.triggerCount}</b>{" "}
								{group.triggerCount === 1 ? "trigger" : "triggers"}. Choose whether to reassign them to
								another group or delete them permanently.
							</p>

							<div className="rounded-lg border border-border/80 bg-surface-secondary/40 p-3">
								<GroupSelect
									groups={others}
									value={target}
									onChange={setMoveTo}
								/>
							</div>

							<div className="flex items-start gap-2 rounded-lg bg-danger-soft/30 border border-danger/20 p-2.5 text-xs text-danger-foreground">
								<TbInfoCircle size={15} className="shrink-0 mt-0.5" />
								<span>{drainNote}</span>
							</div>
						</Modal.Body>

						<Modal.Footer className="flex flex-wrap items-center justify-end gap-2 pt-2">
							<Button variant="ghost" size="sm" onPress={onClose}>
								Cancel
							</Button>
							<Button
								variant="danger-soft"
								size="sm"
								isPending={remove.isPending}
								onPress={() => run({ triggers: "delete" })}
							>
								Delete triggers too
							</Button>
							<Button
								variant="primary"
								size="sm"
								isPending={remove.isPending}
								isDisabled={!target}
								onPress={() => run({ triggers: "move", moveTo: target })}
							>
								Move and delete group
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
