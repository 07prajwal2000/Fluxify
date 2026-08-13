import { useState } from "react";
import { Modal, toast, Button } from "@fluxify/components";
import { projectMembersQuery } from "@/query/projectMembersQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { Member } from "./MembersSettings";
import { type Role } from "../common/RoleSelector";
import { UserRoleSelector } from "../common/UserRoleSelector";

export function ChangeRoleDialog({
	projectId,
	member,
	onClose,
}: {
	projectId: string;
	member: Member;
	onClose: () => void;
}) {
	const update = projectMembersQuery.update.mutation(projectId);
	const [role, setRole] = useState<Role>((member.role as Role) || "viewer");

	function save() {
		update.mutate(
			{ userId: member.userId, role },
			{
				onSuccess: () => {
					toast.success("Role updated");
					onClose();
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	return (
		<Modal isOpen onOpenChange={(o) => !o && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Change role</Modal.Heading>
						</Modal.Header>
						<Modal.Body>
							<UserRoleSelector
								user={{ name: member.name, email: member.email || "" }}
								selectedRole={role}
								onRoleSelect={setRole}
							/>
						</Modal.Body>
						<Modal.Footer>
							<Button variant="ghost" onPress={onClose}>
								Cancel
							</Button>
							<Button variant="primary" isPending={update.isPending} onPress={save}>
								Save
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
