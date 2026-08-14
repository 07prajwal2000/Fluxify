import { TbCheck } from "react-icons/tb";

export const ROLES = [
	{ id: "viewer", title: "Viewer", description: "Can read and run" },
	{ id: "creator", title: "Creator", description: "Can build and deploy" },
	{ id: "project_admin", title: "Project Admin", description: "Full project control" },
] as const;

export type Role = (typeof ROLES)[number]["id"];

export function RoleSelector({
	selectedRole,
	onRoleSelect,
}: {
	selectedRole: Role;
	onRoleSelect: (role: Role) => void;
}) {
	return (
		<div className="flex flex-col gap-3">
			{ROLES.map((role) => (
				<button
					key={role.id}
					type="button"
					onClick={() => onRoleSelect(role.id)}
					className={`relative flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors ${
						selectedRole === role.id
							? "border-accent bg-accent/5"
							: "border-border bg-transparent hover:bg-surface-secondary"
					}`}
				>
					<div className="flex w-full items-center justify-between">
						<span
							className={`text-sm font-medium ${
								selectedRole === role.id ? "text-foreground font-semibold" : "text-muted"
							}`}
						>
							{role.title}
						</span>
						{selectedRole === role.id && <TbCheck className="text-accent" size={16} />}
					</div>
					<span className="text-xs text-muted">{role.description}</span>
				</button>
			))}
		</div>
	);
}
