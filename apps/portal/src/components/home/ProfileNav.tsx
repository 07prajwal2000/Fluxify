import { Avatar, Dropdown } from "@fluxify/components";
import { TbLogout, TbUser } from "react-icons/tb";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";

export function ProfileNav() {
	const { data: session } = authClient.useSession();
	const navigate = useNavigate();

	if (!session?.user) return null;

	const initials = session.user.name?.substring(0, 2).toUpperCase() || "U";

	async function logout() {
		await authClient.signOut();
		navigate({ to: "/login" });
	}

	return (
		<Dropdown>
			<Dropdown.Trigger
				aria-label="Account menu"
				className="rounded-full outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
			>
				<Avatar>
					{session.user.image ? (
						<Avatar.Image src={session.user.image} alt={session.user.name} />
					) : null}
					<Avatar.Fallback>{initials}</Avatar.Fallback>
				</Avatar>
			</Dropdown.Trigger>
			<Dropdown.Popover>
				<Dropdown.Menu>
					<Dropdown.Item
						onAction={() => navigate({ to: "/", search: { tab: "account" } })}
					>
						<TbUser size={18} /> Profile
					</Dropdown.Item>
					<Dropdown.Item onAction={logout}>
						<TbLogout size={18} /> Logout
					</Dropdown.Item>
				</Dropdown.Menu>
			</Dropdown.Popover>
		</Dropdown>
	);
}
