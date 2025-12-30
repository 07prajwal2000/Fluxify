"use client";

import { Image, Menu, Stack } from "@mantine/core";
import { usePathname, useRouter } from "next/navigation";
import React from "react";
import {
  TbCloudCog,
  TbFileText,
  TbHome,
  TbSettings,
  TbSquareKey,
  TbTemplate,
} from "react-icons/tb";
import UpdatesButton from "./updatesButton";
import MenuItem from "./menuItem";
import ProfileSection from "./profileSection";
import ProjectList from "./projectList";
import RequireRoleInAnyProject from "../auth/requireRoleInAnyProject";

const bottomMenuItems = [
  {
    name: "Templates",
    link: "/templates",
    icon: <TbTemplate size={20} />,
  },
  {
    name: "Docs",
    link: "/docs",
    icon: <TbFileText size={20} />,
  },
];

const RootSidebar = () => {
  const router = useRouter();
  const path = usePathname();

  function onMenuItemClick(to: string) {
    router.push(to);
  }

  return (
    <Stack
      style={{
        height: "100%",
      }}
      gap={2}
      py={"md"}
      px={"xs"}
    >
      <Image
        src={"/_/admin/ui/logo_title.webp"}
        style={{ width: "50%" }}
        mx={"auto"}
        alt=""
      />
      <Stack my={"lg"} gap={4}>
        <MenuItem
          leftIcon={<TbHome size={20} />}
          isActive={path === "/"}
          text="Overview"
          onClick={() => onMenuItemClick("/")}
        />
        <RequireRoleInAnyProject requiredRole="creator">
          <MenuItem
            leftIcon={<TbCloudCog size={20} />}
            isActive={path === "/integrations"}
            text="Integrations"
            onClick={() => onMenuItemClick("/integrations")}
          />
        </RequireRoleInAnyProject>
      </Stack>

      <ProjectList />
      <Stack mt={"auto"} gap={4}>
        <UpdatesButton />
        <RequireRoleInAnyProject requiredRole="creator">
          <MenuItem
            leftIcon={<TbSquareKey size={20} />}
            isActive={path === "/app-config"}
            text="App Config"
            onClick={() => onMenuItemClick("/app-config")}
          />
        </RequireRoleInAnyProject>
        {bottomMenuItems.map((item) => (
          <MenuItem
            leftIcon={item.icon}
            isActive={item.link === path}
            key={item.name}
            text={item.name}
            onClick={() => onMenuItemClick(item.link)}
          />
        ))}
        <RequireRoleInAnyProject requiredRole="system_admin">
          <MenuItem
            leftIcon={<TbSettings size={20} />}
            isActive={path === "/settings"}
            text="Instance Settings"
            onClick={() => onMenuItemClick("/settings?tab=Users")}
          />
        </RequireRoleInAnyProject>
        <ProfileSection />
      </Stack>
    </Stack>
  );
};

export default RootSidebar;
