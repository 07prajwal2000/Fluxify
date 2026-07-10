import {
  ActionIcon,
  Box,
  Button,
  Group,
  Paper,
  Text,
  TextInput,
  TextInputProps,
  Tooltip,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React from "react";
import { IoLogoJavascript } from "react-icons/io";
import { TbX } from "react-icons/tb";
import JsEditorDialog from "../dialog/jsEditorDialog";

type Props = {
  jsEditBtnLabel?: string;
  onValueChange?: (value: string) => void;
  onClear?: () => void;
  enableJs?: boolean;
  type?: "text" | "number" | "password";
};

const JsTextInput = ({
  enableJs = true,
  type = "text",
  onValueChange,
  onClear,
  jsEditBtnLabel,
  ...props
}: Props & TextInputProps) => {
  const [opened, { open, close }] = useDisclosure();
  const isJsValue =
    (typeof props.value === "string" && props.value.startsWith("js:")) || false;

  function onClearClicked() {
    onClear && onClear();
    onValueChange &&
      onValueChange(props.defaultValue?.toString() ?? "");
  }

  function handleValueChange(value: string, isJsValue?: boolean) {
    value = isJsValue ? `js:${value}` : value;
    onValueChange && onValueChange(value);
    isJsValue && close();
  }

  if (isJsValue) {
    return (
      <Box w={"100%"}>
        <Text fw={"500"} size="sm">
          {props.label}
        </Text>
        <Text c={"gray"} size="xs" my={2}>
          {props.description}
        </Text>
        <Paper withBorder p={"4"}>
          <Group>
            <Button flex={20} size="xs" color="violet" onClick={open} fullWidth>
              {jsEditBtnLabel || "View / Edit Js Expression"}
            </Button>
            <Tooltip label="Clear Js Expression" withArrow arrowSize={8}>
              <ActionIcon
                onClick={onClearClicked}
                flex={1}
                variant="transparent"
                color="violet"
                w={"100%"}
                disabled={props.disabled}
                h={"100%"}
              >
                <TbX />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Paper>
        <JsEditorDialog
          onClose={close}
          opened={opened}
          readonly={props.disabled}
          value={props.value!.toString().slice(3)}
          onSave={(val) => handleValueChange(val, true)}
          title="Edit Js Expression"
        />
      </Box>
    );
  }
  let iconSize = 15;
  if (props.size === "xs") {
    iconSize = 12;
  } else if (props.size === "sm") {
    iconSize = 15;
  } else if (props.size === "md") {
    iconSize = 18;
  } else if (props.size === "lg") {
    iconSize = 21;
  } else if (props.size === "xl") {
    iconSize = 24;
  }
  return (
    <>
      <TextInput
        {...props}
        type={type}
        onChange={(e) => handleValueChange(e.target.value, false)}
        rightSection={
          enableJs && (
            <ActionIcon disabled={props.disabled} color="violet" onClick={open} size={props.size}>
              <IoLogoJavascript size={iconSize} />
            </ActionIcon>
          )
        }
      />
      <JsEditorDialog
        title="Edit Js Expression"
        onClose={close}
        opened={opened}
        onSave={(val) => handleValueChange(val, true)}
        value={props.value?.toString() || ""}
      />
    </>
  );
};

export default JsTextInput;
