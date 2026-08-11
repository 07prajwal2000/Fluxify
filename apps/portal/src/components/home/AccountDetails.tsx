import { useEffect, useMemo, useState } from "react";
import {
	Avatar,
	Button,
	Card,
	Checkbox,
	Input,
	Label,
	Spinner,
	TextField,
	toast,
} from "@fluxify/components";
import {
	FiCheckCircle,
	FiKey,
	FiLock,
	FiMail,
	FiShield,
	FiUser,
} from "react-icons/fi";
import { authClient } from "@/lib/auth";
import { showErrorNotification } from "@/lib/errorNotifier";

type SessionWithProvider = {
	providerId?: string | null;
};

export function AccountDetails() {
	const { data, isPending } = authClient.useSession();

	if (isPending) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}
	if (!data?.user) {
		return <p className="py-16 text-center text-muted">Couldn't load your profile.</p>;
	}

	const providerId = (data as SessionWithProvider).providerId;
	const isEnterpriseSession = providerId?.toLowerCase().includes("enterprise") ?? false;

	return (
		<div className="mx-auto flex w-full max-w-3xl flex-col gap-5 pt-4">
			<AccountSummary
				name={data.user.name ?? ""}
				email={data.user.email}
				image={data.user.image}
				isEnterpriseSession={isEnterpriseSession}
			/>
			<ProfileSection name={data.user.name ?? ""} email={data.user.email} id={data.user.id} />
			{isEnterpriseSession ? <SsoSecuritySection /> : <PasswordSection />}
		</div>
	);
}

function AccountSummary({
	name,
	email,
	image,
	isEnterpriseSession,
}: {
	name: string;
	email: string;
	image?: string | null;
	isEnterpriseSession: boolean;
}) {
	const initials = useMemo(
		() =>
			name
				.split(" ")
				.filter(Boolean)
				.slice(0, 2)
				.map((part) => part[0])
				.join("")
				.toUpperCase() || "U",
		[name],
	);

	return (
		<Card className="overflow-hidden border-border bg-background">
			<Card.Content className="flex flex-col gap-5 py-6 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-4">
					<Avatar className="h-14 w-14 border border-border text-base">
						{image ? <Avatar.Image src={image} alt={name || "Profile picture"} /> : null}
						<Avatar.Fallback>{initials}</Avatar.Fallback>
					</Avatar>
					<div className="min-w-0">
						<p className="truncate text-lg font-semibold text-foreground">
							{name || "Your profile"}
						</p>
						<p className="mt-0.5 flex items-center gap-1.5 truncate text-sm text-muted">
							<FiMail className="h-3.5 w-3.5 shrink-0" />
							{email}
						</p>
					</div>
				</div>
				<div
					className="inline-flex w-fit items-center gap-2 rounded-full border border-border bg-background-secondary px-3 py-1.5 text-xs font-medium text-foreground"
					aria-label={isEnterpriseSession ? "Signed in through enterprise SSO" : "Password sign-in"}
				>
					{isEnterpriseSession ? (
						<FiShield className="h-3.5 w-3.5 text-accent" />
					) : (
						<FiKey className="h-3.5 w-3.5 text-accent" />
					)}
					{isEnterpriseSession ? "Enterprise SSO" : "Password sign-in"}
				</div>
			</Card.Content>
		</Card>
	);
}

function ProfileSection({ name, email, id }: { name: string; email: string; id: string }) {
	const [username, setUsername] = useState(name);
	const [saving, setSaving] = useState(false);
	const trimmedUsername = username.trim();
	const hasChanges = trimmedUsername !== name;

	useEffect(() => setUsername(name), [name]);

	async function save() {
		if (!trimmedUsername) {
			toast.danger("Enter a display name");
			return;
		}
		setSaving(true);
		try {
			const result = await authClient.updateUser({ name: trimmedUsername });
			if (result.error) toast.danger(result.error.message ?? "Couldn't save profile");
			else toast.success("Profile updated");
		} catch (err) {
			showErrorNotification(err as Error);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Card>
			<Card.Header className="gap-3 sm:flex-row sm:items-start sm:justify-between">
				<div>
					<Card.Title className="flex items-center gap-2">
						<FiUser className="h-4 w-4 text-accent" /> Personal information
					</Card.Title>
					<Card.Description>Update name shown across your workspace.</Card.Description>
				</div>
				<span className="w-fit rounded-md bg-background-secondary px-2 py-1 font-mono text-xs text-muted">
					ID {id.slice(0, 8)}
				</span>
			</Card.Header>
			<Card.Content>
				<div className="grid gap-4 sm:grid-cols-2">
					<TextField value={username} onChange={setUsername} isRequired>
						<Label>Display name</Label>
						<Input placeholder="Your display name" />
					</TextField>
					<TextField value={email} isReadOnly>
						<Label>Email address</Label>
						<Input />
					</TextField>
				</div>
				<p className="mt-4 text-xs text-muted">Your email address is managed by an administrator.</p>
			</Card.Content>
			<Card.Footer className="justify-end">
				<Button variant="primary" isPending={saving} isDisabled={!hasChanges || !trimmedUsername} onPress={save}>
					Save changes
				</Button>
			</Card.Footer>
		</Card>
	);
}

function SsoSecuritySection() {
	return (
		<Card className="border-accent/30">
			<Card.Content className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center">
				<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
					<FiShield className="h-5 w-5" />
				</div>
				<div className="min-w-0 flex-1">
					<p className="flex items-center gap-2 font-medium text-foreground">
						Security managed by Enterprise SSO
						<FiCheckCircle className="h-4 w-4 text-success" />
					</p>
					<p className="mt-1 text-sm text-muted">
						You signed in through your organization. Change your password with your identity provider.
					</p>
				</div>
			</Card.Content>
		</Card>
	);
}

function PasswordSection() {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [revokeOthers, setRevokeOthers] = useState(false);
	const [saving, setSaving] = useState(false);
	const canSave = Boolean(current && next);

	async function save() {
		if (!canSave) {
			toast.danger("Enter your current and new password");
			return;
		}
		setSaving(true);
		try {
			const result = await authClient.changePassword({
				currentPassword: current,
				newPassword: next,
				revokeOtherSessions: revokeOthers,
			});
			if (result.error) toast.danger(result.error.message ?? "Couldn't update password");
			else {
				toast.success("Password updated");
				setCurrent("");
				setNext("");
			}
		} catch (err) {
			showErrorNotification(err as Error);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Card>
			<Card.Header>
				<Card.Title className="flex items-center gap-2">
					<FiLock className="h-4 w-4 text-accent" /> Password & security
				</Card.Title>
				<Card.Description>Use a strong, unique password to protect your account.</Card.Description>
			</Card.Header>
			<Card.Content>
				<div className="grid gap-4 sm:grid-cols-2">
					<TextField type="password" value={current} onChange={setCurrent} isRequired>
						<Label>Current password</Label>
						<Input placeholder="Verify your identity" />
					</TextField>
					<TextField type="password" value={next} onChange={setNext} isRequired>
						<Label>New password</Label>
						<Input placeholder="At least 8 characters" />
					</TextField>
				</div>
				<div className="mt-5 rounded-lg border border-border bg-background-secondary p-3">
					<Checkbox isSelected={revokeOthers} onChange={setRevokeOthers}>
						Sign out other devices
					</Checkbox>
					<p className="ml-6 mt-1 text-xs text-muted">
						Recommended if you no longer recognize every active session.
					</p>
				</div>
			</Card.Content>
			<Card.Footer className="justify-end">
				<Button variant="primary" isPending={saving} isDisabled={!canSave} onPress={save}>
					Update password
				</Button>
			</Card.Footer>
		</Card>
	);
}
