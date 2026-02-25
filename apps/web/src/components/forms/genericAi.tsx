import AppConfigSelector from "@/components/editors/appConfigSelector";
import { Stack, TextInput } from "@mantine/core";
import { UseFormReturnType } from "@mantine/form";

type PropTypes = {
  form: UseFormReturnType<any>;
  showBaseUrl?: boolean;
};

const GenericAiIntegrationForm = ({ form, showBaseUrl }: PropTypes) => {
  return (
    <Stack>
      <TextInput
        label="Name"
        required
        value={form.values.name ?? ""}
        description="Unique Name for the integration"
        placeholder="name"
        {...form.getInputProps("name")}
      />

      {showBaseUrl && (
        <AppConfigSelector
          value={form.values.config.baseUrl ?? ""}
          label="Base URL"
          description="Base URL for the AI"
          placeholder="https://api.openai.com/v1"
          {...form.getInputProps("config.baseUrl")}
          onChange={(value) => form.setFieldValue("config.baseUrl", value)}
        />
      )}
      <AppConfigSelector
        value={form.values.config.apiKey ?? ""}
        label="API Key"
        description="API Key for the AI"
        placeholder="api-key"
        {...form.getInputProps("config.apiKey")}
        onChange={(value) => form.setFieldValue("config.apiKey", value)}
      />
      <TextInput
        label="Model"
        required
        value={form.values.config.model ?? ""}
        description="Model for the AI"
        placeholder="model-name"
        {...form.getInputProps("config.model")}
      />
    </Stack>
  );
};

export default GenericAiIntegrationForm;
