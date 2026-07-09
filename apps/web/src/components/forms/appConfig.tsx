import { getZodValidatedErrors } from "@/lib/forms";
import {
  Checkbox,
  Group,
  Select,
  Stack,
  Textarea,
  TextInput,
  SegmentedControl,
  Text,
  Box
} from "@mantine/core";
import { useForm } from "@mantine/form";
import React, { useEffect } from "react";
import z from "zod";
import { appConfigQuery } from "@/query/appConfigQuery";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";

type PropTypes = {
  onSubmit?: (data: any) => void;
  schema: z.ZodType;
  data?: any;
  children?: React.ReactNode;
  id?: string;
  newRecord?: boolean;
};



const AppConfigForm = (props: PropTypes) => {
  const { projectId } = useParams<{ projectId: string }>();
  const { data, error, isError, isLoading } = appConfigQuery.getById.useQuery(
    projectId as string,
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
          appConfigQuery.getById.invalidate(
            projectId as string,
            props.id ?? "",
            queryClient
          )
        }
      />
    );
  }

  return (
    <form onSubmit={form.onSubmit((data) => props.onSubmit?.(data))}>
      <Stack gap="sm" pb={0}>
        <TextInput
          label="Key Name"
          placeholder="JWT_SECRET"
          size="md"
          className="modern-input"
          {...form.getInputProps("keyName")}
        />
        
        {form.values["dataType"] === "boolean" ? (
          <Checkbox
            label={<Text fw={500} c="#111417" size="sm" style={{ fontFamily: "Inter, sans-serif" }}>Value</Text>}
            color="#7432df"
            description="Value of the configuration. This is the actual value that will be used in the application."
            {...form.getInputProps("value")}
          />
        ) : (
          <TextInput
            label="Value"
            description="Value of the configuration. This is the actual value that will be used in the application."
            placeholder="SUPER SECRET KEY"
            type={form.values["dataType"] === "string" ? "text" : "number"}
            size="md"
            {...form.getInputProps("value")}
          />
        )}
        
        <Textarea
          label="Description"
          placeholder="Add a helpful description..."
          rows={2}
          size="md"
          className="modern-input"
          {...form.getInputProps("description")}
        />

        <Group gap="lg" justify="space-between" align="flex-start" wrap="nowrap">
          <Box style={{ flex: 1 }}>
            <Text size="sm" fw={500} c="#111417" mb={4} style={{ fontFamily: "Inter, sans-serif" }}>Encoding Type</Text>
            <Text size="xs" c="#8d9195" mb="xs" style={{ fontFamily: "Inter, sans-serif", lineHeight: 1.4 }}>
              Select encoding type for the value before storing it.
            </Text>
            <SegmentedControl
              {...form.getInputProps("encodingType")}
              data={[
                { value: "plaintext", label: "Plaintext" },
                { value: "base64", label: "Base64" },
                { value: "hex", label: "Hex" },
              ]}
              color="#7432df"
              radius="md"
              size="sm"
              w="100%"
              style={{ fontFamily: "Inter, sans-serif" }}
            />
          </Box>
          
          <Box style={{ flex: 1 }}>
            <Select
              label="Data Type"
              readOnly={!props.newRecord}
              allowDeselect={false}
              placeholder="Select Data Type"
              description="Type of data being stored."
              size="md"
              {...form.getInputProps("dataType")}
              data={[
                { value: "string", label: "String" },
                { value: "number", label: "Number" },
                { value: "boolean", label: "Boolean" },
              ]}
            />
          </Box>
        </Group>

        <Checkbox
          disabled={data?.isEncrypted}
          label={<Text fw={500} c="#111417" size="sm" style={{ fontFamily: "Inter, sans-serif" }}>Is Encrypted</Text>}
          description="Should the value be encrypted before storing it in the database? Cannot be decrypted once encrypted."
          color="#7432df"
          mt="sm"
          {...form.getInputProps("isEncrypted")}
        />
        
        {props.children}
      </Stack>
    </form>
  );
};

export default AppConfigForm;
