import { useState } from "react";
import {
	Button,
	Chip,
	Checkbox,
	Input,
	Label,
	Modal,
	Spinner,
	Table,
	TextField,
	toast,
} from "@fluxify/components";
import { TbArrowDown, TbArrowUp, TbPlus, TbTrash } from "react-icons/tb";
import { authQuery } from "@/query/authQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { useAuthStore } from "@/store/auth";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";

type UserRow = { id: string; name: string; email: string; role?: string | null; isSystemAdmin?: boolean };
type Pending = { action: "promote" | "demote" | "delete"; user: UserRow } | null;

export function UsersList() {
	const { userData } = useAuthStore();
	const [page, setPage] = useState(1);
	const perPage = 20;
	const { data, isLoading, isError } = authQuery.listUsers.useQuery({ page, perPage });
	const updateUser = authQuery.updateUserPartial.mutation();
	const deleteUser = authQuery.deleteUser.mutation();
	const [pending, setPending] = useState<Pending>(null);

	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}
	if (isError || !data) {
		return <p className="py-16 text-center text-muted">Couldn't load users.</p>;
	}

	const isAdmin = userData?.isSystemAdmin;
	const totalPages = data.pagination?.totalPages ?? 1;

	function confirm() {
		if (!pending) return;
		const { action, user } = pending;
		if (action === "delete") {
			deleteUser.mutate(user.id, {
				onSuccess: () => toast.success("User deleted"),
				onError: (e) => showErrorNotification(e as Error),
			});
		} else {
			updateUser.mutate(
				{ userId: user.id, isSystemAdmin: action === "promote" },
				{
					onSuccess: () =>
						toast.success(action === "promote" ? "User promoted" : "User demoted"),
					onError: (e) => showErrorNotification(e as Error),
				},
			);
		}
		setPending(null);
	}

	return (
		<div className="flex flex-col gap-4 pt-4">
			<div className="flex items-center justify-between">
				<p className="text-sm text-muted">
					{data.data.length} user{data.data.length === 1 ? "" : "s"}
				</p>
				{isAdmin && <AddUserButton />}
			</div>

			<Table aria-label="Users">
				<Table.Header>
					<Table.Column id="name" isRowHeader>Name</Table.Column>
					<Table.Column id="email">Email</Table.Column>
					<Table.Column id="role">Role</Table.Column>
					<Table.Column id="admin">Admin</Table.Column>
					<Table.Column id="actions" aria-label="Actions">{""}</Table.Column>
				</Table.Header>
				<Table.Body>
					{data.data.map((user: UserRow) => {
						const isMe = user.id === userData?.id;
						const role = user.role
							? user.role === "instance_admin"
								? "System admin"
								: "User"
							: "No role";
						return (
							<Table.Row key={user.id} id={user.id}>
								<Table.Cell>
									<span className="flex items-center gap-2">
										{user.name || "<no name>"}
										{isMe && <Chip>You</Chip>}
									</span>
								</Table.Cell>
								<Table.Cell>{user.email}</Table.Cell>
								<Table.Cell>{role}</Table.Cell>
								<Table.Cell>{user.isSystemAdmin ? "Yes" : "No"}</Table.Cell>
								<Table.Cell>
									{isAdmin && !isMe && (
										<div className="flex items-center justify-end gap-1">
												<Button isIconOnly variant="ghost" aria-label={user.isSystemAdmin ? "Demote from admin" : "Promote to admin"} onPress={() => setPending({ action: user.isSystemAdmin ? "demote" : "promote", user })}>
													{user.isSystemAdmin ? <TbArrowDown size={16} /> : <TbArrowUp size={16} />}
												</Button>
												<Button isIconOnly variant="ghost" aria-label="Delete user" onPress={() => setPending({ action: "delete", user })}>
													<TbTrash size={16} />
												</Button>
											</div>
									)}
								</Table.Cell>
							</Table.Row>
						);
					})}
				</Table.Body>
			</Table>

			{totalPages > 1 && (
				<div className="flex items-center justify-end gap-3 text-sm text-muted">
					<Button
						variant="outline"
						isDisabled={page <= 1}
						onPress={() => setPage((p) => p - 1)}
					>
						Previous
					</Button>
					<span>
						Page {page} of {totalPages}
					</span>
					<Button
						variant="outline"
						isDisabled={page >= totalPages}
						onPress={() => setPage((p) => p + 1)}
					>
						Next
					</Button>
				</div>
			)}

			<ConfirmDialog
				open={!!pending}
				onOpenChange={(o) => !o && setPending(null)}
				title={pending?.action === "delete" ? "Delete user?" : "Change admin access?"}
				danger={pending?.action === "delete"}
				confirmText={
					pending?.action === "delete"
						? "Delete"
						: pending?.action === "demote"
							? "Demote"
							: "Promote"
				}
				pending={updateUser.isPending || deleteUser.isPending}
				onConfirm={confirm}
			>
				{pending?.action === "delete" ? (
					<>Delete <b className="text-foreground">{pending.user.name}</b>? This can't be undone.</>
				) : pending ? (
					<>
						{pending.action === "promote" ? "Give" : "Remove"}{" "}
						<b className="text-foreground">{pending.user.name}</b>{" "}
						{pending.action === "promote" ? "system admin access?" : "system admin access?"}
					</>
				) : null}
			</ConfirmDialog>
		</div>
	);
}

function AddUserButton() {
	const create = authQuery.createUser.mutation();
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [admin, setAdmin] = useState(false);

	function reset() {
		setName("");
		setEmail("");
		setPassword("");
		setAdmin(false);
	}

	function submit(e: React.FormEvent) {
		e.preventDefault();
		create.mutate(
			{ email, fullname: name, password, isSystemAdmin: admin, provider: "email-password" },
			{
				onSuccess: () => {
					toast.success("User created");
					reset();
					setOpen(false);
				},
				onError: (err) => showErrorNotification(err as Error),
			},
		);
	}

	return (
		<Modal isOpen={open} onOpenChange={setOpen}>
			<Modal.Trigger>
				<Button variant="outline">
					<TbPlus size={16} /> Add user
				</Button>
			</Modal.Trigger>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="sm">
					<Modal.Dialog>
						<Modal.Header>
							<Modal.Heading>Add a user</Modal.Heading>
						</Modal.Header>
						<form onSubmit={submit}>
							<Modal.Body>
								<div className="flex flex-col gap-4">
									<TextField isRequired value={name} onChange={setName}>
										<Label>Name</Label>
										<Input placeholder="Ada Lovelace" />
									</TextField>
									<TextField isRequired type="email" value={email} onChange={setEmail}>
										<Label>Email</Label>
										<Input placeholder="ada@company.com" />
									</TextField>
									<TextField isRequired type="password" value={password} onChange={setPassword}>
										<Label>Password</Label>
										<Input placeholder="Temporary password" />
									</TextField>
									<Checkbox isSelected={admin} onChange={setAdmin}>
										Make system admin
									</Checkbox>
								</div>
							</Modal.Body>
							<Modal.Footer>
								<Button variant="ghost" onPress={() => setOpen(false)}>
									Cancel
								</Button>
								<Button type="submit" variant="primary" isPending={create.isPending}>
									Add user
								</Button>
							</Modal.Footer>
						</form>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
