"use client";
import { Button, Divider, Group, Modal, Text } from "@mantine/core";
import React, { useState } from "react";

type PropTypes = {
  title: React.ReactNode;
  children?: React.ReactNode;
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
  open: boolean;
  onClose: () => void;
  confirmColor?: string;
};

const ConfirmDialog = (props: PropTypes) => {
  const [loading, setLoading] = useState(false);

  function onConfirm() {
    try {
      setLoading(true);
      props.onConfirm?.();
    } catch (err) {
      throw err;
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      size={"md"}
      opened={props.open}
      withCloseButton={false}
      onClose={props.onClose}
    >
      <Text size="xl" fw={"500"}>
        {props.title}
      </Text>
      <Divider mt={4} mb={"xs"} />
      {typeof props.children === "function" ? (
        props.children
      ) : (
        <Text>{props.children}</Text>
      )}
      <Group gap={4} my={"sm"} style={{ float: "right" }}>
        <Button
          onClick={onConfirm}
          variant=""
          color={props.confirmColor ?? "red"}
        >
          {props.confirmText ?? "Confirm"}
        </Button>
        <Button onClick={props.onClose} variant="subtle" color="dark">
          {props.cancelText ?? "Cancel"}
        </Button>
      </Group>
    </Modal>
  );
};

export default ConfirmDialog;
