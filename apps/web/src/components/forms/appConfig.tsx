import { getZodValidatedErrors } from "@/lib/forms";
import {
  Checkbox,
  Group,
  Select,
  Stack,
  Textarea,
  TextInput,
} from "@mantine/core";
import { useForm } from "@mantine/form";
import React, { useEffect } from "react";
import z from "zod";
import { appConfigQuery } from "@/query/appConfigQuery";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { useQueryClient } from "@tanstack/react-query";

type PropTypes = {
  onSubmit?: (data: any) => void;
  schema: z.ZodType;
  data?: any;
  children?: React.ReactNode;
  id?: string;
  newRecord?: boolean;
};

const AppConfigForm = (props: PropTypes) => {
  const { data, error, isError, isLoading } = appConfigQuery.getById.useQuery(
    props.id ?? ""
  );
  const form = useForm({
    initialValues: data ||
      props.data || {
        keyName: "",
        value: "",
        description: "",
        isEncrypted: false,
        dataType: "string",
        encodingType: "plaintext",
      },
    validate: getZodValidatedErrors(props.schema!),
  });
  const queryClient = useQueryClient();

  useEffect(() => {
    if (data) {
      form.setValues(data);
    }
  }, [data]);

  if (isLoading) {
    return <QueryLoader skeletonsCols={1} skeletonsRows={4} />;
  }

  if (isError) {
    return (
      <QueryError
        overrideMessage="Error loading configuration"
        error={error}
        refetcher={() =>
          appConfigQuery.getById.invalidate(props.id ?? "", queryClient)
        }
      />
    );
  }

  return (
    <form onSubmit={form.onSubmit((data) => props.onSubmit?.(data))}>
      <Stack>
        <TextInput
          label="Key Name"
          placeholder="JWT_SECRET"
          {...form.getInputProps("keyName")}
        />
        {form.values["dataType"] === "boolean" ? (
          <Checkbox
            label="Value"
            color="violet"
            description="Value of the configuration. This is the actual value that will be used in the application."
            placeholder="SUPER SECRET KEY"
            {...form.getInputProps("value")}
          />
        ) : (
          <TextInput
            label="Value"
            description="Value of the configuration. This is the actual value that will be used in the application."
            placeholder="SUPER SECRET KEY"
            type={form.values["dataType"] === "string" ? "text" : "number"}
            {...form.getInputProps("value")}
          />
        )}
        <Textarea
          label="Description"
          placeholder="Description"
          rows={3}
          {...form.getInputProps("description")}
        />
        <Group gap={"lg"} justify="space-between" wrap="nowrap">
          <Select
            label="Encoding Type"
            placeholder="Select Encoding Type"
            description="Select encoding type for the value. This is used to encode the value before storing it in the database."
            {...form.getInputProps("encodingType")}
            data={[
              { value: "plaintext", label: "Plaintext" },
              { value: "base64", label: "Base64" },
              { value: "hex", label: "Hex" },
            ]}
            allowDeselect={false}
          />
          <Select
            label="Data Type"
            readOnly={!props.newRecord}
            allowDeselect={false}
            placeholder="Select Encoding Type"
            description="Select encoding type for the value. This is used to encode the value before storing it in the database."
            {...form.getInputProps("dataType")}
            data={[
              { value: "string", label: "String" },
              { value: "number", label: "Number" },
              { value: "boolean", label: "Boolean" },
            ]}
          />
        </Group>
        <Checkbox
          disabled={data?.isEncrypted}
          label="Is Encrypted"
          placeholder="Is Encrypted"
          description="Should the value be encrypted before storing it in the database? Cannot be decrypted once encrypted."
          {...form.getInputProps("isEncrypted")}
          color="violet"
        />
        <br />
        {props.children}
      </Stack>
    </form>
  );
};

export default AppConfigForm;
