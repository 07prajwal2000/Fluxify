import AppConfigSelector from "@/components/editors/appConfigSelector";
import { Stack, TextInput, ButtonGroup, Button, Grid } from "@mantine/core";
import { UseFormReturnType } from "@mantine/form";
import { useState } from "react";

type PropTypes = {
  form: UseFormReturnType<any>;
};

const OpenObserveIntegrationForm = ({ form }: PropTypes) => {
  const isCredentialsSelected =
    typeof form.values.config.credentials === "object";
  function selectCredentials() {
    form.setFieldValue("config.credentials", { username: "", password: "" });
  }
  function selectBase64() {
    form.setFieldValue("config.credentials", "");
  }
  return (
    <Stack>
      <TextInput
        label="Name"
        required
        value={form.values.name ?? ""}
        description="Unique Name for the integration"
        placeholder="Open Observe | Production"
        {...form.getInputProps("name")}
      />
      <AppConfigSelector
        value={form.values.config.baseUrl ?? ""}
        onChange={(value) => form.setFieldValue("config.baseUrl", value)}
        label="Base Url"
        description="Base url of the open observe instance (should contain in the structure like below)"
        placeholder="https://openobserve:5080/api/org_name"
      />
      <ButtonGroup bd={"1px solid violet"} bdrs={"md"} w={"100%"}>
        <Button
          variant={isCredentialsSelected ? "subtle" : "filled"}
          color="violet"
          fullWidth
          onClick={selectBase64}
        >
          Base64 Encoded
        </Button>
        <Button
          onClick={selectCredentials}
          variant={isCredentialsSelected ? "filled" : "subtle"}
          color="violet"
          fullWidth
        >
          Credentials
        </Button>
      </ButtonGroup>
      <Stack>
        {!isCredentialsSelected && (
          <AppConfigSelector
            value={form.values.config.credentials ?? ""}
            onChange={(value) =>
              form.setFieldValue("config.credentials", value)
            }
            label="Base64 Value"
            description="Base64 Encoded Credential username:password (Basic Auth)"
            placeholder={btoa("RANDOM_DATA")}
          />
        )}
      </Stack>
      {isCredentialsSelected && (
        <Grid columns={2}>
          <Grid.Col span={1}>
            <AppConfigSelector
              value={form.values.config.credentials.username ?? ""}
              onChange={(value) =>
                form.setFieldValue("config.credentials.username", value)
              }
              label="Email"
              description="Email address for the Open Observe"
              placeholder="email@company.co"
            />
          </Grid.Col>
          <Grid.Col span={1}>
            <AppConfigSelector
              value={form.values.config.credentials.password ?? ""}
              onChange={(value) =>
                form.setFieldValue("config.credentials.password", value)
              }
              label="Password"
              description="Password for the Open Observe"
              placeholder="password"
            />
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
};

export default OpenObserveIntegrationForm;
