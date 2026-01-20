"use client";

import {
  ActionIcon,
  Box,
  Button,
  Center,
  Divider,
  Group,
  Kbd,
  Menu,
  Paper,
  Skeleton,
  Stack,
  Text,
  Textarea,
  useMantineTheme,
} from "@mantine/core";
import Link from "next/link";
import React from "react";
import { BiBrush, BiMessageDetail } from "react-icons/bi";
import { IoMdReturnLeft } from "react-icons/io";
import { MdErrorOutline } from "react-icons/md";
import {
  TbArrowsExchange,
  TbDots,
  TbMessage2Plus,
  TbSend,
} from "react-icons/tb";
import QueryError from "../query/queryError";

const AiChatDrawer = () => {
  return (
    <Paper h={"100%"} withBorder>
      <Stack gap={"xs"} h={"100%"}>
        <Group justify="center" align="center" w={"100%"}>
          <Center>
            <img
              src="/_/admin/ui//ai_window_logo.webp"
              style={{ width: "80px" }}
              alt=""
            />
          </Center>
          <Menu>
            <Menu.Target>
              <ActionIcon
                style={{ position: "absolute", right: "1em", top: "1em" }}
                variant="outline"
                color="violet"
              >
                <TbDots />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<TbArrowsExchange />}>
                Change Provider
              </Menu.Item>
              <Menu.Item
                color="red.8"
                leftSection={
                  <BiBrush style={{ transform: "rotate(180deg)" }} />
                }
              >
                Clear Chat
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
        <Divider />
        <Box style={{ flex: 1, height: "100%" }}>
          <ChatListRenderer chatMessages={[]} aiProviderExist />
        </Box>
        <Group m={"xs"} pos={"relative"}>
          <Textarea
            w={"100%"}
            rows={4}
            placeholder={"Ask Fluxify AI"}
          ></Textarea>
          <Group
            bottom={0}
            left={0}
            right={0}
            pos={"absolute"}
            w={"100%"}
            justify="space-between"
          >
            <Button
              variant="light"
              ml={"auto"}
              leftSection={<TbSend />}
              color={"violet"}
            >
              Send
            </Button>
          </Group>
        </Group>
      </Stack>
    </Paper>
  );
};

type ChatListRendererProps = {
  chatMessages: {}[];
  aiProviderExist?: boolean;
  loading?: boolean;
};

const ChatListRenderer = (props: ChatListRendererProps) => {
  const colors = useMantineTheme().colors;

  if (props.loading) {
    return (
      <Stack justify="end" h={"100%"} p={"sm"}>
        <Skeleton h={100} w={"80%"} />
        <Skeleton h={80} ml={"auto"} w={"80%"} />
        <Skeleton h={120} w={"80%"} />
        <Skeleton h={60} ml={"auto"} w={"80%"} />
      </Stack>
    );
  }
  if (props.chatMessages.length === 0) {
    return (
      <Stack justify="center" align="center" h={"100%"}>
        <TbMessage2Plus size={150} color={colors.gray[4]} />
        <Stack gap={"xs"} c={colors.dark[7]} align="center">
          <Text>No chat history found</Text>
          <Text>Start a conversation by sending a message to AI</Text>
        </Stack>
        {!props.aiProviderExist && (
          <Paper withBorder w={"max(400px, 80%)"} p={"sm"} c="red.8">
            <Group align="center">
              <MdErrorOutline size={30} />
              <Stack h={"fit-content"} gap={"6px"}>
                <Text>Provider is not set</Text>
                <Text size="sm">
                  Please configure the AI provider to use this feature
                </Text>
              </Stack>
              <Center w={"100%"}>
                <Link href={"/integrations"}>
                  <Button
                    size="xs"
                    variant="outline"
                    color="violet"
                    leftSection={<IoMdReturnLeft />}
                  >
                    Goto Integrations
                  </Button>
                </Link>
              </Center>
            </Group>
          </Paper>
        )}
      </Stack>
    );
  }
  return <Stack></Stack>;
};

export default AiChatDrawer;
