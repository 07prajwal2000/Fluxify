import { RoleSelector, type Role } from "./RoleSelector";

export function UserRoleSelector({
	user,
	selectedRole,
	onRoleSelect,
}: {
	user: { name: string | null; email: string };
	selectedRole: Role;
	onRoleSelect: (role: Role) => void;
}) {
	const getInitials = (name: string | null, email: string) => {
		if (name) {
			const parts = name.split(" ");
			if (parts.length > 1) return parts[0][0].toUpperCase() + parts[1][0].toUpperCase();
			return name.substring(0, 2).toUpperCase();
		}
		return email.substring(0, 2).toUpperCase();
	};

	return (
		<div className="flex flex-col gap-6">
			<div className="flex items-center gap-3 rounded-xl border border-border bg-surface-secondary p-3">
				<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-xs font-semibold text-foreground ring-1 ring-border">
					{getInitials(user.name, user.email)}
				</div>
				<div className="flex flex-col">
					<span className="text-sm font-medium text-foreground">
						{user.name || user.email}
					</span>
					<span className="text-xs text-muted-foreground">{user.email}</span>
				</div>
			</div>

			<div className="flex flex-col gap-3">
				<p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
					Role
				</p>
				<RoleSelector selectedRole={selectedRole} onRoleSelect={onRoleSelect} />
			</div>
		</div>
	);
}
