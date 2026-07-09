import { Modal, Text } from "@mantine/core";
import React from "react";

const FormDialog = ({
  open,
  onClose,
  children,
  title,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) => {
  return (
    <Modal
      opened={open}
      size={"xl"}
      title={
        <Text fw={"600"} size="xl" style={{ fontFamily: "Hanken Grotesk, sans-serif" }}>
          {title}
        </Text>
      }
      withCloseButton
      onClose={onClose}
      styles={{
        header: { paddingBottom: 4 },
        body: { paddingTop: 0 }
      }}
    >
      <Modal.Body pt={0} px="xs" pb="xs">{children}</Modal.Body>
    </Modal>
  );
};

export default FormDialog;
