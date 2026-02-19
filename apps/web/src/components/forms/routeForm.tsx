import { Paper, Select, Text, TextInput } from "@mantine/core";
import { useForm } from "@mantine/form";
import { notifications } from "@mantine/notifications";
import { useParams, usePathname } from "next/navigation";
import React from "react";
import z from "zod";

type PropTypes = {
  newForm?: boolean;
  values?: Partial<{
    id: string;
    name: string | null;
    path: string | null;
    method: string | null;
    active: boolean | null;
    projectId: string | null;
  }>;
  onSubmit?: (value: {
    id: string;
    name: string;
    path: string;
    method: string;
    active: boolean;
    projectId?: string;
  }) => void;
  zodSchema: z.ZodType;
  actionSection?: React.ReactNode;
};

const RouteForm = (props: PropTypes) => {
  const isPersonalPage = usePathname() === "/";
  const params = useParams();
  const projectId = isPersonalPage ? "personal" : params.projectId?.toString();
  const form = useForm({
    mode: "uncontrolled",
    initialValues: {
      name: props.values?.name || "",
      path: props.values?.path || "",
      method: props.values?.method || "GET",
      projectId,
      active: props.values?.active || false,
    },
  });

  function onSubmit(value: typeof form.values) {
    const { success, data, error } = props.zodSchema.safeParse(value);
    if (!success) {
      for (let err of error.issues) {
        const path = err.path[0].toString();
        if (!(path in form.values)) {
          notifications.show({
            title: `Validation Error on field: ${path}`,
            message: err.message,
            color: "red",
          });
        } else form.setFieldError(path, err.message);
      }
      return;
    }
    props.onSubmit?.({
      id: props.values?.id ?? "",
      ...(data as typeof value),
    });
  }

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <TextInput
        label="Name"
        placeholder="Create user"
        {...form.getInputProps("name")}
      />
      <TextInput
        label="Path"
        placeholder="/api/users/create"
        {...form.getInputProps("path")}
      />
      <Select
        label="Method"
        placeholder="POST"
        data={["GET", "POST", "PUT", "DELETE"]}
        {...form.getInputProps("method")}
      />
      {props.newForm && isPersonalPage && (
        <Paper p={"md"} my={"md"} shadow="sm" bg={"yellow"}>
          <Text size="sm">
            Route created here will use personal project.
            <br />
            Select a project if you want a route associated with a project.
          </Text>
        </Paper>
      )}
      {props.actionSection}
    </form>
  );
};

export default RouteForm;
