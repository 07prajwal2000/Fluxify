import { useState, useMemo } from "react";
import { Button, Chip, Spinner, Table, toast, Dropdown, Label, Avatar } from "@fluxify/components";
import { TbDots, TbTrash, TbUserEdit, TbUserPlus } from "react-icons/tb";
import { projectMembersQuery } from "@/query/projectMembersQuery";
import { projectsQuery } from "@/query/projectsQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { AddMemberModal } from "./AddMemberModal";
import { ChangeRoleDialog } from "./ChangeRoleDialog";

const ROLES = ["viewer", "creator", "project_admin"] as const;
type Role = (typeof ROLES)[number];

export type Member = { id: string; userId: string; name: string; email?: string; role: string };

export function MembersSettings({ projectId }: { projectId: string }) {
	const [page, setPage] = useState(1);
	const { data, isLoading, isError } = projectMembersQuery.list.useQuery(projectId, {
		page,
		perPage: 20,
	});
	
	// Get total members from projects query
	const { data: projectsData } = projectsQuery.getAll.useQuery({ page: 1, perPage: 50 });
	const membersCount = projectsData?.data?.find((p: any) => p.id === projectId)?.totalUsers;

	const remove = projectMembersQuery.remove.mutation(projectId);
	const [editing, setEditing] = useState<Member | null>(null);
	const [pendingRemove, setPendingRemove] = useState<Member | null>(null);
	const [addMemberOpen, setAddMemberOpen] = useState(false);

	const totalPages = data?.pagination?.totalPages ?? 1;
	const membersList = (data?.data ?? []) as Member[];
	const existingMemberUserIds = useMemo(() => membersList.map((m) => m.userId), [membersList]);

	const getInitials = (name: string, email: string = "") => {
		if (name) {
			const parts = name.split(" ");
			if (parts.length > 1) return parts[0][0].toUpperCase() + parts[1][0].toUpperCase();
			return name.substring(0, 2).toUpperCase();
		}
		return email.substring(0, 2).toUpperCase() || "??";
	};

	const getRoleColor = (role: string) => {
		switch (role) {
			case "project_admin":
				return "success";
			case "creator":
				return "default";
			default:
				return "default";
		}
	};

	return (
		<div className="flex flex-col gap-4">
			<div className="flex items-center justify-between mb-2">
				<div className="flex items-center gap-3">
					<h1 className="text-xl font-semibold tracking-tight text-foreground">Members</h1>
					{membersCount !== undefined && (
						<span className="text-xl text-muted-foreground">{membersCount}</span>
					)}
				</div>
				<Button
					variant="primary"
					onPress={() => setAddMemberOpen(true)}
				>
					<TbUserPlus size={18} />
					Add Member
				</Button>
			</div>

			{isLoading ? (
				<div className="flex justify-center py-16">
					<Spinner />
				</div>
			) : isError ? (
				<p className="py-16 text-center text-muted">Couldn't load members.</p>
			) : (
				<Table>
					<Table.Content aria-label="Members">
						<Table.Header>
							<Table.Column id="member" isRowHeader>
								MEMBER
							</Table.Column>
							<Table.Column id="role">ROLE</Table.Column>
							<Table.Column id="actions" aria-label="Actions">
								ACTIONS
							</Table.Column>
						</Table.Header>
						<Table.Body items={membersList}>
							{(m: Member) => (
								<Table.Row id={m.userId}>
									<Table.Cell>
										<div className="flex items-center gap-4 py-2">
											<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-sm font-semibold text-foreground ring-1 ring-border">
												{getInitials(m.name, m.email)}
											</div>
											<div className="flex flex-col">
												<span className="text-sm font-medium text-foreground">
													{m.name || m.email || "Unknown User"}
												</span>
												<span className="text-xs font-mono text-muted-foreground tracking-tight">
													{m.email || m.userId}
												</span>
											</div>
										</div>
									</Table.Cell>
									<Table.Cell>
										<Chip 
											color={getRoleColor(m.role) as any} 
											variant="soft" 
											size="sm" 
											className="uppercase text-[10px] tracking-wider font-bold"
										>
											{m.role.replace("_", " ")}
										</Chip>
									</Table.Cell>
									<Table.Cell>
										<div className="flex justify-end">
											<Dropdown>
												<Dropdown.Trigger>
													<Button isIconOnly variant="ghost" aria-label="Member options">
														<TbDots size={16} />
													</Button>
												</Dropdown.Trigger>
												<Dropdown.Popover>
													<Dropdown.Menu>
														<Dropdown.Item
															onAction={() => setEditing(m)}
															textValue="Change role"
														>
															<TbUserEdit size={16} />
															<Label>Change role</Label>
														</Dropdown.Item>
														<Dropdown.Item 
															onAction={() => setPendingRemove(m)} 
															variant="danger" 
															textValue="Remove member"
															className="text-danger hover:bg-danger/10 focus:bg-danger/10 focus:text-danger"
														>
															<TbTrash size={16} className="text-danger" />
															<Label className="text-danger">Remove member</Label>
														</Dropdown.Item>
													</Dropdown.Menu>
												</Dropdown.Popover>
											</Dropdown>
										</div>
									</Table.Cell>
								</Table.Row>
							)}
						</Table.Body>
					</Table.Content>
				</Table>
			)}

			{totalPages > 1 && (
				<div className="flex items-center justify-end gap-3 text-sm text-muted mt-2">
					<Button variant="outline" isDisabled={page <= 1} onPress={() => setPage((p) => p - 1)}>
						Previous
					</Button>
					<span>
						Page {page} of {totalPages}
					</span>
					<Button variant="outline" isDisabled={page >= totalPages} onPress={() => setPage((p) => p + 1)}>
						Next
					</Button>
				</div>
			)}

			{editing && (
				<ChangeRoleDialog
					projectId={projectId}
					member={editing}
					onClose={() => setEditing(null)}
				/>
			)}

			<ConfirmDialog
				open={!!pendingRemove}
				onOpenChange={(o) => !o && setPendingRemove(null)}
				title="Remove member?"
				danger
				confirmText="Remove"
				pending={remove.isPending}
				onConfirm={() => {
					if (!pendingRemove) return;
					remove.mutate(pendingRemove.userId, {
						onSuccess: () => toast.success("Member removed"),
						onError: (e) => showErrorNotification(e as Error),
					});
					setPendingRemove(null);
				}}
			>
				Remove <b className="text-foreground">{pendingRemove?.name || pendingRemove?.email}</b> from this project?
			</ConfirmDialog>

			<AddMemberModal
				projectId={projectId}
				existingMembers={existingMemberUserIds}
				isOpen={addMemberOpen}
				onOpenChange={setAddMemberOpen}
			/>
		</div>
	);
}
