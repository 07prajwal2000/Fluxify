import { Stack, PasswordInput, Button, Text, Checkbox, Group } from "@mantine/core";
import React from "react";
import { authClient } from "@/lib/auth";
import { showNotification } from "@mantine/notifications";

const PasswordForm = () => {
	const [currentPassword, setCurrentPassword] = React.useState("");
	const [password, setPassword] = React.useState("");
	const [pwdLoading, setPwdLoading] = React.useState(false);
	const [logoutOtherSessions, setLogoutOtherSessions] = React.useState(false);
	function onPasswordChange(value: string) {
		setPassword(value);
	}
	function onCurrentPasswordChange(value: string) {
		setCurrentPassword(value);
	}
	async function onSavePasswordClicked() {
		if (!password) return;
		try {
			setPwdLoading(true);
			const result = await authClient.changePassword({
				currentPassword,
				newPassword: password,
			});
			if (result.error) {
				showNotification({
					title: "Error",
					message: result.error.message,
					color: "red",
				});
			} else {
				if (logoutOtherSessions) {
					await authClient.revokeOtherSessions();
				}
				showNotification({
					message: "Saved successfully",
					color: "green",
				});
			}
		} catch (error: any) {
			showNotification({
				message: "Failed to save new password",
				title: "Error",
				color: "red",
			});
		} finally {
			setPwdLoading(false);
		}
	}
	return (
		<Stack gap="lg" w="100%" maw={600}>
			<Group grow align="flex-start">
				<PasswordInput
					description="Type your current password to verify identity"
					label="Current Password"
					name="password"
					value={currentPassword}
					onChange={(e) => onCurrentPasswordChange(e.target.value)}
					size="md"
				/>
				<PasswordInput
					description="Must be at least 8 characters long"
					label="New Password"
					name="new_password"
					value={password}
					onChange={(e) => onPasswordChange(e.target.value)}
					size="md"
				/>
			</Group>

			<Checkbox
				color="#7432df"
				label={<Text fw={500} size="sm" c="#111417" style={{ fontFamily: "Inter, sans-serif" }}>Revoke other sessions</Text>}
				description={<Text size="xs" c="#8d9195" style={{ fontFamily: "Inter, sans-serif", marginTop: 2 }}>Logout all other active sessions on different devices</Text>}
				checked={logoutOtherSessions}
				onChange={(e) => setLogoutOtherSessions(e.target.checked)}
				mt="xs"
			/>

			<Group justify="flex-start" mt="md">
				<Button
					color="violet"
					onClick={onSavePasswordClicked}
					loading={pwdLoading}
					size="md"
					radius="md"
					style={{ backgroundColor: "#7432df", fontFamily: "Inter, sans-serif", fontWeight: 600 }}
				>
					Update Password
				</Button>
			</Group>
		</Stack>
	);
};

export default PasswordForm;
