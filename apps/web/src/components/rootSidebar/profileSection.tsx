"use client";
import { ActionIcon, Avatar, Group, Menu, Paper, Text } from "@mantine/core";
import React from "react";
import { TbDots, TbLogout, TbSettings } from "react-icons/tb";
import { authClient } from "@/lib/auth";
import { redirect, useRouter } from "next/navigation";

const menuItems = [
  {
    title: "Settings",
    url: "/settings",
    icon: <TbSettings size={20} />,
  },
  {
    title: "Logout",
    url: "logout-btn",
    icon: <TbLogout color="red" size={20} />,
  },
];

const ProfileSection = () => {
  const session = authClient.useSession();
  const nav = useRouter();
  const username =
    session.data?.user.name?.split(" ")[0].substring(0, 15) || "User";
  function onMenuItemClick(action: string) {
    if (action === "logout-btn") {
      logout();
    } else {
      nav.push(action);
    }
  }

  const logout = async () => {
    await authClient.signOut();
    redirect("/login");
  };

  return (
    <Paper p={"5px"} bdrs={"sm"} withBorder shadow="xs">
      <Group w={"100%"} justify="space-between" align="center">
        <Avatar color={"violet"} src={session.data?.user.image}>
          {session.data?.user.image
            ? null
            : session.data?.user.name?.substring(0, 2).toUpperCase()}
        </Avatar>
        <Text style={{ flex: 1 }}>{username}</Text>
        <Menu shadow="sm" width={200} position="right-end">
          <Menu.Target>
            <ActionIcon color="dark" variant="subtle">
              <TbDots />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown p={"xs"}>
            {menuItems.map((item) => (
              <Menu.Item
                key={item.title}
                leftSection={item.icon}
                onClick={() => onMenuItemClick(item.url)}
              >
                {item.title}
              </Menu.Item>
            ))}
          </Menu.Dropdown>
        </Menu>
      </Group>
    </Paper>
  );
};

export default ProfileSection;
