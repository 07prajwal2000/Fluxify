"use client";

import { authClient } from "@/lib/auth";
import React, { useState } from "react";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { Button, Stack, TextInput, Group, Tabs } from "@mantine/core";
import { showErrorNotification } from "@/lib/errorNotifier";
import { showNotification } from "@mantine/notifications";
import PasswordForm from "./passwordForm";
import { TbUser, TbShieldLock } from "react-icons/tb";

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
    <Stack w="100%" maw={1000} pt="md">
      <Tabs defaultValue="personal" color="violet" orientation="vertical" variant="pills" keepMounted={false}>
        <Tabs.List w={{ base: "100%", sm: 250 }} mr={{ base: 0, sm: "xl" }} mb={{ base: "md", sm: 0 }}>
          <Tabs.Tab value="personal" leftSection={<TbUser size={18} />}>
            Personal Information
          </Tabs.Tab>
          <Tabs.Tab value="security" leftSection={<TbShieldLock size={18} />}>
            Security Settings
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="personal" pl={{ base: 0, sm: "xl" }} style={{ flex: 1 }}>
          <Stack gap="lg" w="100%" maw={600}>
            <Group grow align="flex-start">
              <TextInput
                label="User Name"
                value={username}
                description="Your display name"
                name="username"
                onChange={(e) => onNameChange(e.target.value)}
                size="md"
              />
              <TextInput 
                label="Email Address" 
                value={email} 
                description="Your primary email (cannot be changed)" 
                readOnly 
                size="md" 
              />
            </Group>
            
            <TextInput 
              label="User ID" 
              value={id} 
              description="Unique identifier for your account" 
              disabled 
              size="md" 
            />

            <Group justify="flex-start" mt="md">
              <Button
                color="violet"
                onClick={onSaveClicked}
                loading={isPending || isRefetching}
                size="md"
                radius="md"
                style={{ backgroundColor: "#7432df", fontFamily: "Inter, sans-serif", fontWeight: 600 }}
              >
                Save Changes
              </Button>
            </Group>
          </Stack>
        </Tabs.Panel>

        <Tabs.Panel value="security" pl={{ base: 0, sm: "xl" }} style={{ flex: 1 }}>
          <PasswordForm />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
};

export default AccountDetails;
