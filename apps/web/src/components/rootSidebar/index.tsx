"use client";

import { Image, Stack } from "@mantine/core";
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

const topMenuItems = [
  {
    name: "Overview",
    link: "/",
    icon: <TbHome size={20} />,
  },
  {
    name: "Integrations",
    link: "/integrations",
    icon: <TbCloudCog size={20} />,
  },
];
const bottomMenuItems = [
  {
    name: "App Config",
    link: "/app-config",
    icon: <TbSquareKey size={20} />,
  },
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
        {topMenuItems.map((item) => (
          <MenuItem
            leftIcon={item.icon}
            isActive={item.link === path}
            key={item.name}
            text={item.name}
            onClick={() => onMenuItemClick(item.link)}
          />
        ))}
      </Stack>
      <ProjectList />
      <Stack mt={"auto"} gap={4}>
        <UpdatesButton />
        {bottomMenuItems.map((item) => (
          <MenuItem
            leftIcon={item.icon}
            isActive={item.link === path}
            key={item.name}
            text={item.name}
            onClick={() => onMenuItemClick(item.link)}
          />
        ))}
        <ProfileSection />
      </Stack>
    </Stack>
  );
};

export default RootSidebar;
