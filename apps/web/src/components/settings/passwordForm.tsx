import { Stack, PasswordInput, Button, Text, Checkbox } from "@mantine/core";
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
    <Stack>
      <Text size="1.5rem" fw={"500"} c={"dark"}>
        Password
      </Text>
      <PasswordInput
        description="Type your current password here"
        label="Current Password"
        name="password"
        value={currentPassword}
        onChange={(e) => onCurrentPasswordChange(e.target.value)}
      />
      <PasswordInput
        description="Type a new password here"
        label="New Password"
        name="new_password"
        value={password}
        onChange={(e) => onPasswordChange(e.target.value)}
      />
      <Checkbox
        color="violet"
        label="Revoke other sessions"
        description="Logout all other sessions except this one"
        checked={logoutOtherSessions}
        onChange={(e) => setLogoutOtherSessions(e.target.checked)}
      />
      <Button
        color="red.8"
        variant="outline"
        onClick={onSavePasswordClicked}
        loading={pwdLoading}
      >
        Change Password
      </Button>
    </Stack>
  );
};

export default PasswordForm;
