import {
  useEditorSearchbarStore,
} from "@/store/editor";
import { ActionIcon, Box, Group, Kbd, Paper, Stack, Text } from "@mantine/core";
import React, { useEffect } from "react";
import SearchInput from "./searchInput";
import BlockSearchList from "./blockSearchList";

const BlockSearchDrawer = () => {
  const { opened, close, setSearchQuery } = useEditorSearchbarStore();
  const divRef = React.useRef<HTMLDivElement>(null);
  const ref = React.useRef<HTMLInputElement>(null);
  const addNewBtnRef = React.useRef<HTMLElement>(null);

  useEffect(() => {
    addNewBtnRef.current = document.getElementById("add-new-block");
  }, []);

  useEffect(() => {
    if (opened) {
      document.addEventListener("click", handleClickEvent);
      setTimeout(() => {
        ref.current?.focus();
      }, 300);
    } else {
      document.removeEventListener("click", handleClickEvent);
      ref.current?.blur();
      setSearchQuery("");
    }
    return () => {
      ref.current?.blur();
      document.removeEventListener("click", handleClickEvent);
    };
  }, [opened]);

  function handleClickEvent(ev: MouseEvent) {
    if (
      divRef.current &&
      !divRef.current.contains(ev.target as Node) &&
      !addNewBtnRef.current?.contains(ev.target as Node)
    ) {
      close();
    }
  }

  return (
    <>
      <Paper
        ref={divRef}
        shadow="md"
        withBorder
        style={{
          zIndex: 1000,
          position: "absolute",
          right: opened ? 0 : "-25%",
          top: 0,
          transition: "right 0.3s",
        }}
        h={"100%"}
        w={"25%"}
        bg={"white"}
      >
        <Stack h={"100%"} gap={"sm"}>
          <Box>
            <Group bg={"gray.7"} c={"white"} justify="space-between">
              <Text size="md" fw={"400"} py={"sm"} px={"md"}>
                Search Block to add
              </Text>
              <ActionIcon
                c={"white"}
                variant="subtle"
                onClick={close}
                size="xs"
                mr={"md"}
                w={"fit-content"}
                h={"fit-content"}
              >
                <Kbd size="xs">Esc</Kbd>
              </ActionIcon>
            </Group>
            <Box p={"sm"} pb={0}>
              <SearchInput ref={ref} />
            </Box>
          </Box>
          <Box flex={1} mb={"md"} style={{ overflowY: "auto" }}>
            <BlockSearchList />
          </Box>
        </Stack>
      </Paper>
    </>
  );
};

export default BlockSearchDrawer;
