"use client";
import { Button } from "@mantine/core";
import { useRouter } from "next/navigation";
import React from "react";
import { TbArrowNarrowLeft } from "react-icons/tb";

type Props = {
  routeId: string;
};

const BackToEditorButton = (props: Props) => {
  const router = useRouter();

  function onClick() {
    router.replace(`/editor/${props.routeId}`);
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
