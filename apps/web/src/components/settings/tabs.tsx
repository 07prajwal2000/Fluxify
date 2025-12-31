"use client";

import { Box, Tabs, useMantineTheme } from "@mantine/core";
import { TbUserCircle } from "react-icons/tb";
import { AiOutlineUsergroupAdd } from "react-icons/ai";
import { GrDeploy } from "react-icons/gr";
import { MdOutlineVerifiedUser } from "react-icons/md";
import { FaNpm } from "react-icons/fa6";
import RequireRoleInAnyProject from "../auth/requireRoleInAnyProject";
import AccountDetails from "./accountDetails";
import UsersList from "./usersList";
import { useRouter, useSearchParams } from "next/navigation";

type Props = {};

const SettingsTabs = (props: Props) => {
  const query = useSearchParams();
  const router = useRouter();
  function onTabClicked(value: string | null) {
    if (!value) return;
    router.replace(`?tab=${value}`);
  }
  let tab = query.get("tab") || "Personal";
  // validate tab
  if (!["Personal", "Users", "Deployments", "Authentication"].includes(tab)) {
    router.replace("?tab=Personal");
    tab = "Personal";
  }
  return (
    <Tabs onChange={onTabClicked} color="violet" defaultValue={tab}>
      <Tabs.List w={"fit-content"}>
        <Tabs.Tab leftSection={<TbUserCircle size={18} />} value="Personal">
          Personal
        </Tabs.Tab>
        <Tabs.Tab
          leftSection={<AiOutlineUsergroupAdd size={18} />}
          value="Users"
        >
          Users
        </Tabs.Tab>
        <RequireRoleInAnyProject requiredRole="project_admin">
          <Tabs.Tab leftSection={<GrDeploy size={16} />} value="Deployments">
            Deployments
          </Tabs.Tab>
        </RequireRoleInAnyProject>
        <RequireRoleInAnyProject requiredRole="system_admin">
          <Tabs.Tab
            leftSection={<MdOutlineVerifiedUser size={18} />}
            value="Authentication"
          >
            Authentication
          </Tabs.Tab>
        </RequireRoleInAnyProject>
      </Tabs.List>
      <Box py={"sm"}>
        <Tabs.Panel value="Personal">
          <AccountDetails />
        </Tabs.Panel>
        <Tabs.Panel value="Users">
          <UsersList />
        </Tabs.Panel>
        <Tabs.Panel value="Deployments">
          <p>Not implemented</p>
        </Tabs.Panel>
        <Tabs.Panel value="Authentication">
          <p>Not implemented</p>
        </Tabs.Panel>
        <Tabs.Panel value="NPM Packages">
          <p>Not implemented</p>
        </Tabs.Panel>
      </Box>
    </Tabs>
  );
};

export default SettingsTabs;
