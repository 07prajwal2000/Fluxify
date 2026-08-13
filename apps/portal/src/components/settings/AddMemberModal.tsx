import { useState, useMemo } from "react";
import { Button, Modal, Input, toast, LazyLoader } from "@fluxify/components";
import { TbSearch } from "react-icons/tb";
import { authQuery } from "@/query/authQuery";
import { projectMembersQuery } from "@/query/projectMembersQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { type Role } from "../common/RoleSelector";
import { UserRoleSelector } from "../common/UserRoleSelector";

type UserRow = {
	id: string;
	name: string | null;
	email: string;
};

export function AddMemberModal({
	projectId,
	existingMembers,
	isOpen,
	onOpenChange,
}: {
	projectId: string;
	existingMembers: string[];
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const [step, setStep] = useState<1 | 2>(1);
	const [search, setSearch] = useState("");
	const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
	const [selectedRole, setSelectedRole] = useState<Role>("viewer");

	const {
		data: infiniteData,
		isLoading: isLoadingUsers,
		isFetchingNextPage,
		hasNextPage,
		fetchNextPage,
	} = authQuery.listUsers.useInfiniteQuery({
		perPage: 50,
	});

	const addMutation = projectMembersQuery.add.mutation(projectId);

	const availableUsers = useMemo(() => {
		if (!infiniteData?.pages) return [];
		const allUsers = infiniteData.pages.flatMap((page) => page.data) as UserRow[];
		return allUsers.filter(
			(user) =>
				!existingMembers.includes(user.id) &&
				((user.name?.toLowerCase() || "").includes(search.toLowerCase()) ||
					user.email.toLowerCase().includes(search.toLowerCase())),
		);
	}, [infiniteData, search, existingMembers]);

	function handleClose() {
		setStep(1);
		setSearch("");
		setSelectedUser(null);
		setSelectedRole("viewer");
		onOpenChange(false);
	}

	function handleUserSelect(user: UserRow) {
		setSelectedUser(user);
		setStep(2);
	}

	function handleAdd() {
		if (!selectedUser) return;
		addMutation.mutate(
			{ userId: selectedUser.id, role: selectedRole },
			{
				onSuccess: () => {
					toast.success("Member added");
					handleClose();
				},
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	}

	const getInitials = (name: string | null, email: string) => {
		if (name) {
			const parts = name.split(" ");
			if (parts.length > 1) return parts[0][0].toUpperCase() + parts[1][0].toUpperCase();
			return name.substring(0, 2).toUpperCase();
		}
		return email.substring(0, 2).toUpperCase();
	};

	return (
		<Modal isOpen={isOpen} onOpenChange={(o) => !o && handleClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<div className="flex items-center justify-between pb-3">
								<Modal.Heading>Add member</Modal.Heading>
							</div>
							{/* Stepper highlight */}
							<div className="flex gap-2 mb-4">
								<div
									className={`h-1 flex-1 rounded-full transition-colors ${step >= 1 ? "bg-[#ccff00]" : "bg-[#252836]"}`}
								/>
								<div
									className={`h-1 flex-1 rounded-full transition-colors ${step >= 2 ? "bg-[#ccff00]" : "bg-[#252836]"}`}
								/>
							</div>
						</Modal.Header>

						<Modal.Body className="py-2">
							{step === 1 ? (
								<div className="flex flex-col gap-4">
									<p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
										Find a user
									</p>
									<Input
										placeholder="Search by name or email"
										value={search}
										onChange={(e) => setSearch(e.target.value)}
									/>

									<div className="mt-2 flex max-h-[250px] flex-col overflow-y-auto pr-1">
										<LazyLoader
											items={availableUsers}
											isLoading={isLoadingUsers}
											isFetchingNextPage={isFetchingNextPage}
											hasNextPage={!!hasNextPage}
											fetchNextPage={fetchNextPage}
											className="flex flex-col gap-2"
											emptyMessage="No users found."
											renderItem={(user: UserRow) => (
												<button
													key={user.id}
													type="button"
													className="flex items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-white/[0.04]"
													onClick={() => handleUserSelect(user)}
												>
													<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#1A1C23] text-xs font-semibold text-zinc-300 ring-1 ring-white/10">
														{getInitials(user.name, user.email)}
													</div>
													<div className="flex flex-col">
														<span className="text-sm font-medium text-foreground">
															{user.name || user.email}
														</span>
														<span className="text-xs text-muted-foreground">{user.email}</span>
													</div>
												</button>
											)}
										/>
									</div>
								</div>
							) : (
								<UserRoleSelector
									user={selectedUser!}
									selectedRole={selectedRole}
									onRoleSelect={setSelectedRole}
								/>
							)}
						</Modal.Body>

						{step === 2 && (
							<Modal.Footer>
								<Button variant="outline" onPress={() => setStep(1)}>
									Back
								</Button>
								<Button
									variant="primary"
									onPress={handleAdd}
									isPending={addMutation.isPending}
									className="bg-[#ccff00] text-black hover:bg-[#b3e600]"
								>
									Add to project
								</Button>
							</Modal.Footer>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
