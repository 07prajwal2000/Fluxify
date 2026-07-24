import { useState } from "react";
import {
	Button,
	Card,
	Checkbox,
	Input,
	Label,
	Spinner,
	TextField,
	toast,
} from "@fluxify/components";
import { authClient } from "@/lib/auth";
import { showErrorNotification } from "@/lib/errorNotifier";

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

	return (
		<div className="flex max-w-2xl flex-col gap-6 pt-4">
			<ProfileSection
				name={data.user.name ?? ""}
				email={data.user.email}
				id={data.user.id}
			/>
			<PasswordSection />
		</div>
	);
}

function ProfileSection({ name, email, id }: { name: string; email: string; id: string }) {
	const [username, setUsername] = useState(name);
	const [saving, setSaving] = useState(false);

	async function save() {
		if (!username) return;
		setSaving(true);
		try {
			const result = await authClient.updateUser({ name: username });
			if (result.error) toast.danger(result.error.message ?? "Couldn't save");
			else toast.success("Profile updated");
		} catch (err) {
			showErrorNotification(err as Error);
		} finally {
			setSaving(false);
		}
	}

	return (
		<Card>
			<Card.Header>
				<Card.Title>Profile</Card.Title>
				<Card.Description>Your account details</Card.Description>
			</Card.Header>
			<Card.Content>
				<div className="flex flex-col gap-4">
					<TextField value={username} onChange={setUsername}>
						<Label>Name</Label>
						<Input placeholder="Your display name" />
					</TextField>
					<TextField value={email} isReadOnly>
						<Label>Email</Label>
						<Input />
					</TextField>
					<TextField value={id} isDisabled>
						<Label>User ID</Label>
						<Input />
					</TextField>
				</div>
			</Card.Content>
			<Card.Footer>
				<Button variant="primary" isPending={saving} onPress={save}>
					Save changes
				</Button>
			</Card.Footer>
		</Card>
	);
}

function PasswordSection() {
	const [current, setCurrent] = useState("");
	const [next, setNext] = useState("");
	const [revokeOthers, setRevokeOthers] = useState(false);
	const [saving, setSaving] = useState(false);

	async function save() {
		if (!next) return;
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
				<Card.Title>Password</Card.Title>
				<Card.Description>Change your password</Card.Description>
			</Card.Header>
			<Card.Content>
				<div className="flex flex-col gap-4">
					<TextField type="password" value={current} onChange={setCurrent}>
						<Label>Current password</Label>
						<Input placeholder="Verify your identity" />
					</TextField>
					<TextField type="password" value={next} onChange={setNext}>
						<Label>New password</Label>
						<Input placeholder="At least 8 characters" />
					</TextField>
					<Checkbox isSelected={revokeOthers} onChange={setRevokeOthers}>
						Sign out other devices
					</Checkbox>
				</div>
			</Card.Content>
			<Card.Footer>
				<Button variant="primary" isPending={saving} onPress={save}>
					Update password
				</Button>
			</Card.Footer>
		</Card>
	);
}
