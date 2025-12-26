"use client";

import { integrationsQuery } from "@/query/integrationsQuery";
import React, { useEffect } from "react";
import QueryLoader from "../query/queryLoader";
import QueryError from "../query/queryError";
import { useQueryClient } from "@tanstack/react-query";
import { ZodType } from "zod";
import { useForm } from "@mantine/form";
import {
  ActionIcon,
  ActionIconProps,
  Button,
  Group,
  Select,
  Stack,
} from "@mantine/core";
import {
  getSchema,
  getIntegrationsGroups,
  getIntegrationsVariants,
  getDefaultVariantValue,
} from "@fluxify/server/src/api/v1/integrations/helpers";
import { getZodValidatedErrors } from "@/lib/forms";
import PostgresForm from "./databases/postgres";
import TestIntegrationConnectionButton from "../buttons/testIntegrationConnectionButton";
import SaveIntegrationButton from "../buttons/saveIntegrationButton";
import { TbTrash } from "react-icons/tb";
import ConfirmDialog from "../dialog/confirmDialog";
import { useDisclosure } from "@mantine/hooks";

type PropTypes = {
  onSubmit?: (data: any) => void;
  data?: { name: string; group: string; variant: string; config: any };
  id?: string;
  showTestConnection?: boolean;
  isLoading?: boolean;
  showSaveButton?: boolean;
  saveButtonLabel?: string;
  disableButtons?: string[];
  showDeleteButton?: boolean;
  onDelete?: () => void;
  deleteButtonProps?: ActionIconProps;
};

const IntegrationForm = (props: PropTypes) => {
  const useQuery = integrationsQuery.getById.query;
  const {
    data: loadedData,
    isLoading,
    isError,
    error,
  } = useQuery(props.id || "");
  const data = props.data || loadedData;
  const [
    deleteModalOpened,
    { open: openDeleteModal, close: closeDeleteModal },
  ] = useDisclosure();
  const form = useForm({
    initialValues: {
      name: data?.name || "",
      group: data?.group || "",
      variant: data?.variant || "",
      config: data?.config,
    },
    onValuesChange(values, previous) {
      if (previous.variant !== values.variant) {
        form.setValues({
          ...values,
          config: (getDefaultVariantValue(values.variant as any) as any) ?? {},
        });
      }
    },
    validate(values) {
      const schema = getSchema(values.group as any, values.variant as any);
      if (!schema) {
        return {
          group: "Invalid group",
          variant: "Invalid variant",
        };
      }
      return getZodValidatedErrors(schema)(values.config, "config.");
    },
  });
  const client = useQueryClient();

  useEffect(() => {
    if (loadedData) {
      form.setValues(loadedData);
    }
  }, [loadedData]);

  if (isLoading) {
    return <QueryLoader skeletonsCols={1} skeletonsRows={3} />;
  }
  if (isError) {
    return (
      <QueryError
        error={error}
        refetcher={() => {
          integrationsQuery.getById.invalidate(props.id || "", client);
        }}
      />
    );
  }
  return (
    <form onSubmit={form.onSubmit((values) => props.onSubmit?.(values))}>
      <Stack>
        <Select
          readOnly={props.disableButtons?.includes("group")}
          label="Choose a Connector"
          description="Choose from a range of connectors to get started"
          {...form.getInputProps("group")}
          value={form.values.group}
          data={getIntegrationsGroups()}
        />
        {form.values.group && (
          <Select
            label="Select Variant"
            readOnly={props.disableButtons?.includes("variant")}
            value={form.values.variant}
            description="Select the service you want to configure & connect to"
            {...form.getInputProps("variant")}
            data={getIntegrationsVariants(form.values.group as any)}
          />
        )}
        {form.values.group === "database" &&
          form.values.variant === "PostgreSQL" && <PostgresForm form={form} />}
        <Group justify="space-between">
          {props.showTestConnection &&
            form.values.group &&
            form.values.variant && (
              <TestIntegrationConnectionButton
                data={form.values.config}
                group={form.values.group}
                variant={form.values.variant}
              />
            )}
          <Group>
            {props.showDeleteButton && (
              <>
                <ConfirmDialog
                  onClose={closeDeleteModal}
                  open={deleteModalOpened}
                  title="Are you sure want to delete the Integration"
                  onConfirm={() => {
                    props.onDelete?.();
                    closeDeleteModal();
                  }}
                >
                  You are about to delete the integration. This action is
                  irreversible.
                </ConfirmDialog>
                <ActionIcon
                  size={"lg"}
                  color="red.7"
                  onClick={openDeleteModal}
                  {...props.deleteButtonProps}
                >
                  <TbTrash />
                </ActionIcon>
              </>
            )}
            {props.showSaveButton &&
              form.values.group &&
              form.values.variant && (
                <SaveIntegrationButton
                  loading={props.isLoading}
                  label={props.saveButtonLabel}
                />
              )}
          </Group>
        </Group>
      </Stack>
    </form>
  );
};

export default IntegrationForm;
