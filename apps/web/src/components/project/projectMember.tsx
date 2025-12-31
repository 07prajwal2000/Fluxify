import {
  ActionIcon,
  Avatar,
  Badge,
  Group,
  Menu,
  Paper,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import React, { useEffect, useState } from "react";
import { AiOutlineUserSwitch } from "react-icons/ai";
import { FaUserSlash } from "react-icons/fa6";
import { TbDots } from "react-icons/tb";
import ConfirmDialog from "../dialog/confirmDialog";
import { projectMembersQuery } from "@/query/projectMembersQuery";
import { useParams } from "next/navigation";
import RequireRole from "../auth/requireRole";

interface Props {
  data: {
    id: string;
    userId: string;
    name: string;
    role: string;
  };
}

const RoleColors: Record<string, string> = {
  creator: "green.8",
  project_admin: "orange.8",
  system_admin: "violet.8",
  viewer: "cyan.8",
};

const ProjectMember = (props: Props) => {
  const [selectedRole, setSelectedRole] = useState(props.data.role);
  const [opened, { open: openRemoveUser, close: closeRemoveUser }] =
    useDisclosure();
  const [roleChangeOpened, { open: openRoleChange, close: closeRoleChange }] =
    useDisclosure();
  const { projectId } = useParams();
  const { mutate: removeMutation } = projectMembersQuery.remove.useMutation(
    projectId?.toString() || ""
  );
  const { mutate: updateMutation } = projectMembersQuery.update.useMutation(
    projectId?.toString() || ""
  );
  const username = props.data.name || "<No Name>";

  function confirmRemoveUser() {
    const result = removeMutation(props.data.userId);
    closeRemoveUser();
  }
  function confirmRoleChange() {
    if (selectedRole === props.data.role) {
      return;
    }
    updateMutation({
      userId: props.data.userId,
      body: {
        role: selectedRole as any,
      },
    });
    closeRoleChange();
  }

  useEffect(() => {
    if (!roleChangeOpened) {
      setSelectedRole(props.data.role);
    }
  }, [roleChangeOpened]);

  return (
    <Paper withBorder p={"xs"} bdrs={"sm"} bg={"white"}>
      <Group justify="space-between">
        <Group>
          <Avatar />
          <Text>{username}</Text>
        </Group>
        <Group gap={"xl"}>
          <Badge color={RoleColors[props.data.role]}>
            {props.data.role.replaceAll("_", " ")}
          </Badge>
          <Menu withArrow arrowSize={15} shadow="sm">
            <RequireRole
              projectId={projectId?.toString() || ""}
              requiredRole="project_admin"
            >
              <Menu.Target>
                <ActionIcon color="dark" variant="subtle">
                  <TbDots />
                </ActionIcon>
              </Menu.Target>
            </RequireRole>
            <Menu.Dropdown>
              <Menu.Item
                onClick={openRoleChange}
                leftSection={<AiOutlineUserSwitch size={18} />}
              >
                Change role
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                onClick={openRemoveUser}
                c={"red.9"}
                leftSection={<FaUserSlash size={18} />}
              >
                Remove from project
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      <ConfirmDialog
        onClose={closeRemoveUser}
        open={opened}
        title={"Are you sure?"}
        confirmText="Remove"
        confirmColor="red.7"
        onConfirm={confirmRemoveUser}
        children={
          <span>
            Are you sure want to remove <b>{username}</b> from this project?
          </span>
        }
      />
      <ConfirmDialog
        onClose={closeRoleChange}
        open={roleChangeOpened}
        title="Change role"
        confirmText="Change"
        confirmColor="violet"
        onConfirm={confirmRoleChange}
        children={
          <Stack>
            <Text>
              You are about to change the role for <b>{username}</b>
            </Text>
            <Select
              description="Please select a different role to change"
              data={[
                { label: "Viewer", value: "viewer" },
                { label: "Creator", value: "creator" },
                { label: "Project Admin", value: "project_admin" },
              ]}
              value={selectedRole}
              onChange={(e) => setSelectedRole(e!)}
            />
          </Stack>
        }
      />
    </Paper>
  );
};

export default ProjectMember;
