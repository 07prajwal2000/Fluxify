"use client";
import { Button } from "@mantine/core";
import { useRouter } from "next/navigation";
import React from "react";
import { TbArrowNarrowLeft } from "react-icons/tb";

type Props = {
  routeId: string;
  projectId: string;
};

const BackToEditorButton = (props: Props) => {
  const router = useRouter();

  function onClick() {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push(`/${props.projectId}/editor/${props.routeId}`);
    }
  }

  return (
    <Button
      color="violet"
      w={"fit-content"}
      variant="outline"
      onClick={onClick}
      leftSection={<TbArrowNarrowLeft />}
    >
      Back to editor
    </Button>
  );
};

export default BackToEditorButton;
