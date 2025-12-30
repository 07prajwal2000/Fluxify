"use client";

import { Button, Checkbox, PasswordInput, Stack } from "@mantine/core";
import React from "react";
import { TbPlus } from "react-icons/tb";
import FormDialog from "../dialog/formDialog";
import { useDisclosure } from "@mantine/hooks";
import { TextInput } from "@mantine/core";
import { authQuery } from "@/query/authQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { showNotification } from "@mantine/notifications";

const AddNewUserForm = () => {
  const [opened, { open, close }] = useDisclosure(false);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isSystemAdmin, setIsSystemAdmin] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const createUserMutation = authQuery.createUser.mutation();

  function handleSubmit() {
    try {
      setLoading(true);

      createUserMutation.mutate({
        email,
        isSystemAdmin,
        provider: "email-password",
        fullname: name,
        password,
      });

      showNotification({
        title: "User created",
        message: "User created successfully",
        color: "green",
      });
      // reset form
      setName("");
      setEmail("");
      setPassword("");
      setIsSystemAdmin(false);
      handleCancel();
    } catch (error: any) {
      showErrorNotification(error, true);
      console.log(error);
    } finally {
      setLoading(false);
    }
  }

  function handleCancel() {
    close();
    setName("");
    setEmail("");
    setPassword("");
    setIsSystemAdmin(false);
  }

  return (
    <Stack>
      <Button
        leftSection={<TbPlus size={15} />}
        variant="outline"
        color="violet"
        size="xs"
        onClick={open}
      >
        Add new user
      </Button>
      <FormDialog title="Add new user" open={opened} onClose={handleCancel}>
        <Stack>
          <TextInput
            label="Name"
            placeholder="Name"
            required
            value={name}
            onChange={(e) => setName(e.currentTarget.value)}
          />
          <TextInput
            label="Email"
            placeholder="Email"
            autoComplete=""
            required
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
          />
          <PasswordInput
            label="Password"
            autoComplete=""
            placeholder="Password"
            required
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
          />
          <Checkbox
            label="System Admin"
            description="Give this user system admin permissions"
            color="violet"
            checked={isSystemAdmin}
            onChange={(e) => setIsSystemAdmin(e.currentTarget.checked)}
          />
          <Button
            variant="outline"
            color="green.8"
            onClick={handleSubmit}
            loading={loading}
          >
            Save
          </Button>
        </Stack>
      </FormDialog>
    </Stack>
  );
};

export default AddNewUserForm;
