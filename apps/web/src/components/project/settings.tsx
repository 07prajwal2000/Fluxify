"use client";

import { Group, Stack, useMantineTheme } from "@mantine/core";
import React from "react";
import MenuItem from "../rootSidebar/menuItem";
import { FaNpm, FaUsers } from "react-icons/fa6";
import RequireRole from "../auth/requireRole";
import { useParams } from "next/navigation";
import { useProjectSettingsSidebarStore } from "@/store/projectSettings";
import { useProjectSettingsActions } from "@/store/projectSettings";
import ProjectMembersList from "./projectMembersList";
import ProjectInfo from "./projectInfo";
import { TbInfoCircle } from "react-icons/tb";

interface Props {
  disableNpm?: boolean;
}

const ProjectSettings = (props: Props) => {
  const red = useMantineTheme().colors.red;
  const { projectId } = useParams();
  const sidebarStore = useProjectSettingsSidebarStore();
  const { setSidebarActive } = useProjectSettingsActions();

  return (
    <Group
      w={"100%"}
      style={{ overflow: "hidden" }}
      py={"md"}
      h={"78vh"}
      flex={1}
      justify="space-around"
    >
      <Stack flex={1} p={"xs"} bg={"gray.1"} w={"30%"} h={"100%"} gap={"xs"}>
        <MenuItem
          isActive={sidebarStore.active === "projectInfo"}
          text={"Project Info"}
          color="dark"
          onClick={() => {
            setSidebarActive("projectInfo");
          }}
          leftIcon={<TbInfoCircle size={20} />}
        />
        <MenuItem
          isActive={sidebarStore.active === "projectMembers"}
          text={"Members"}
          color="dark"
          onClick={() => {
            setSidebarActive("projectMembers");
          }}
          leftIcon={<FaUsers size={20} />}
        />
        {!props.disableNpm && (
          <RequireRole
            requiredRole="creator"
            projectId={(projectId as string) || ""}
          >
            <MenuItem
              isActive={sidebarStore.active === "npmPackages"}
              text={"NPM Packages"}
              color="dark"
              onClick={() => {
                setSidebarActive("npmPackages");
              }}
              leftIcon={<FaNpm color={red[8]} size={25} />}
            />
          </RequireRole>
        )}
      </Stack>
      <Stack flex={4} w={"65%"} h={"100%"} style={{ overflow: "hidden" }}>
        {sidebarStore.active === "projectMembers" && <ProjectMembersList />}
        {sidebarStore.active === "projectInfo" && <ProjectInfo />}
      </Stack>
    </Group>
  );
};

export default ProjectSettings;
