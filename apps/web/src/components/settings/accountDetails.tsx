"use client";

import { authClient } from "@/lib/auth";
import React, { useState } from "react";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { Button, Divider, Stack, TextInput } from "@mantine/core";
import { TbDeviceFloppy } from "react-icons/tb";
import { showErrorNotification } from "@/lib/errorNotifier";
import { showNotification } from "@mantine/notifications";
import PasswordForm from "./passwordForm";

const AccountDetails = () => {
  const { data, error, isPending, refetch, isRefetching } =
    authClient.useSession();
  const [username, setUsername] = useState(data?.user.name || "");
  if (isPending) return <QueryLoader />;
  if (error || !data?.user)
    return (
      <QueryError
        error={error!}
        overrideMessage="Failed to load the profile"
        refetcher={refetch}
      />
    );
  function onNameChange(value: string) {
    setUsername(value);
  }
  async function onSaveClicked() {
    if (!username) return;
    try {
      const result = await authClient.updateUser({
        name: username,
      });
      if (result.error) {
        showNotification({
          message: result.error.message,
          color: "red",
        });
      } else {
        showNotification({
          message: "Saved successfully",
          color: "green",
        });
      }
    } catch (error: any) {
      showErrorNotification(error, true);
    }
  }

  const { email, id } = data!.user;
  return (
    <Stack w={"min(50%, 500px)"}>
      <TextInput label="User Id" value={id} disabled />
      <TextInput
        label="User name"
        value={username}
        description="Name of the user"
        name="username"
        onChange={(e) => onNameChange(e.target.value)}
      />
      <TextInput label="Email" value={email} readOnly />
      <Button
        color="violet"
        leftSection={<TbDeviceFloppy size={20} />}
        w={"fit-content"}
        variant="outline"
        onClick={onSaveClicked}
        loading={isPending || isRefetching}
      >
        Save
      </Button>
      <Divider />
      <PasswordForm />
    </Stack>
  );
};

export default AccountDetails;
