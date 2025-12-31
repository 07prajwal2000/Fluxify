"use client";

import { authClient } from "@/lib/auth";
import { showErrorNotification } from "@/lib/errorNotifier";
import {
  Button,
  Divider,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { isAxiosError } from "axios";
import { useRouter } from "next/navigation";
import React, { useState } from "react";

const LoginForm = () => {
  const router = useRouter();
  const form = useForm({ initialValues: { email: "", password: "" } });
  const [loading, setLoading] = useState(false);
  const onSubmit = async (values: { email: string; password: string }) => {
    setLoading(true);
    try {
      const result = await authClient.signIn.email(values);
      if (result.error) {
        notifications.show({
          title: "Failed to login",
          message: result.error.message,
          color: "red",
        });
      }
      if (result.data?.user) {
        notifications.show({
          title: "Logged in successfully",
          message: "Logged-in as " + result.data?.user?.email,
          color: "green",
        });
        router.replace("/");
      }
    } catch (error) {
      if (isAxiosError(error) && error.response?.data.type === "validation") {
        form.setErrors(error.response?.data.errors);
      } else {
        showErrorNotification(error as Error, false);
      }
      console.log(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Paper withBorder p="md" shadow="sm" w={"500px"}>
      <form onSubmit={form.onSubmit(onSubmit)}>
        <Stack>
          <Text fw={"bold"} ta={"center"} size={"xl"}>
            LOGIN
          </Text>
          <Divider />
          <TextInput
            placeholder="Email"
            type="email"
            required
            {...form.getInputProps("email")}
          />
          <PasswordInput
            placeholder="Password"
            required
            {...form.getInputProps("password")}
          />
          <Button
            color="violet"
            type="submit"
            w={"100%"}
            mt={"md"}
            loading={loading}
          >
            Login
          </Button>
        </Stack>
      </form>
    </Paper>
  );
};

export default LoginForm;
