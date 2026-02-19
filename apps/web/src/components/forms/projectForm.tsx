import React from "react";
import { useForm } from "@mantine/form";
import { TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import z from "zod";

type PropTypes = {
  newForm?: boolean;
  values?: Partial<{
    name: string;
  }>;
  onSubmit?: (value: { name: string }) => void;
  zodSchema: z.ZodType;
  actionSection?: React.ReactNode;
};

const ProjectForm = (props: PropTypes) => {
  const form = useForm({
    initialValues: props.values || {
      name: "",
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
      name: value.name!,
    });
  }

  return (
    <form onSubmit={form.onSubmit(onSubmit)}>
      <TextInput
        label="Name"
        placeholder="Project Name"
        {...form.getInputProps("name")}
      />
      {props.actionSection}
    </form>
  );
};

export default ProjectForm;
