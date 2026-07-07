import { Button, Group, Modal } from "@mantine/core";
import React, { useState } from "react";
import JsEditor from "../editors/jsEditor";

type PropTypes = {
  onClose: () => void;
  opened: boolean;
  onSave?: (value: string) => void;
  value?: string;
  readonly?: boolean;
  title?: string;
  description?: React.ReactNode;
};

const JsEditorDialog = (props: PropTypes) => {
  const [js, setJs] = useState(props.value || "");
  return (
    <Modal
      title={props.title || "Javascript Editor"}
      onClose={props.onClose}
      size={"xl"}
      opened={props.opened}
      onKeyDown={(e) => e.stopPropagation()}
    >
      {props.description}
      <JsEditor
        defaultValue={js}
        readonly={props.readonly}
        height={350}
        onChange={setJs}
      />
      <Group justify="end">
        <Button
          color="violet"
          my={"sm"}
          onClick={() => props.onSave && props.onSave(js)}
        >
          Save
        </Button>
        <Button
          color="dark"
          variant="outline"
          my={"sm"}
          onClick={() => props.onClose()}
        >
          Cancel
        </Button>
      </Group>
    </Modal>
  );
};

export default JsEditorDialog;
